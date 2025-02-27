import { Meteor } from 'meteor/meteor';
import { Random } from 'meteor/random';
import { _ } from 'meteor/underscore';
import debug from '../debug';
import { RedisPipe, Events } from '../constants';
import getFieldsOfInterestFromAll from './lib/getFieldsOfInterestFromAll';
import Config from '../config';

class RedisSubscriptionManager {
    init() {
        if (this.isInitialized) {
            debug('[RedisSubscriptionManager] Init called, but was already initialized.');
            return;
        }
        this.uid = Random.id();
        this.queue = new Meteor._SynchronousQueue();
        this.store = {}; // {channel: [RedisSubscribers]}
        this.channelHandlers = {}; // {channel: handler}

        this.isInitialized = true;

        debug(`[RedisSubscriptionManager] Initialized. Uid: ${this.uid}`);
    }

    /**
     * Returns all RedisSubscribers regardless of channel
     */
    getAllRedisSubscribers() {
        let redisSubscribers = [];
        for (let channel in this.store) {
            this.store[channel].forEach(_redisSubscriber =>
                redisSubscribers.push(_redisSubscriber)
            );
        }

        return redisSubscribers;
    }

    /**
     * @param redisSubscriber
     */
    attach(redisSubscriber) {
        this.queue.queueTask(() => {
            _.each(redisSubscriber.channels, channel => {
                if (!this.store[channel]) {
                    this.initializeChannel(channel);
                }

                this.store[channel].push(redisSubscriber);
            });
        });
    }

    /**
     * @param redisSubscriber
     */
    detach(redisSubscriber) {
        this.queue.queueTask(() => {
            _.each(redisSubscriber.channels, channel => {
                if (!this.store[channel]) {
                    return debug(
                        '[RedisSubscriptionManager] Trying to detach a subscriber on a non existent channels.'
                    );
                } else {
                    this.store[channel] = _.without(
                        this.store[channel],
                        redisSubscriber
                    );

                    if (this.store[channel].length === 0) {
                        this.destroyChannel(channel);
                    }
                }
            });
        });
    }

    /**
     * @param channel
     */
    initializeChannel(channel) {
        debug(`[RedisSubscriptionManager] Subscribing to channel: ${channel}`);

        // create the handler for this channel
        const self = this;
        const handler = function(message) {
            self.queue.queueTask(() => {
                self.process(channel, message, true);
            });
        };

        this.channelHandlers[channel] = handler;
        this.store[channel] = [];

        const { pubSubManager } = Config;
        pubSubManager.subscribe(channel, handler);
    }

    /**
     * @param channel
     */
    destroyChannel(channel) {
        debug(
            `[RedisSubscriptionManager] Unsubscribing from channel: ${channel}`
        );

        const { pubSubManager } = Config;
        pubSubManager.unsubscribe(channel, this.channelHandlers[channel]);

        delete this.store[channel];
        delete this.channelHandlers[channel];
    }

    /**
     * @param channel
     * @param data
     * @param [fromRedis=false]
     */
    process(channel, data, fromRedis) {
        let isSynthetic = data[RedisPipe.SYNTHETIC];

        // messages from redis that contain our uid were handled
        // optimistically, so we can drop them.
        if (fromRedis && data[RedisPipe.UID] === this.uid) {
            debug(
                `[RedisSubscriptionManager] Ignored (same UID) ${
                    isSynthetic ? 'synthetic ' : ''
                }event: "${data[RedisPipe.EVENT]}" to "${channel}" (${data.d?._id})`
            )
            return;
        }

        const subscribers = this.store[channel];
        if (!subscribers) {
            debug(
                `[RedisSubscriptionManager] Ignored (no subscribers) ${
                    isSynthetic ? 'synthetic ' : ''
                }event: "${data[RedisPipe.EVENT]}" to "${channel}" (${data.d?._id})`
            )
            return;
        }

        debug(
            `[RedisSubscriptionManager] Received ${
                isSynthetic ? 'synthetic ' : ''
            }event: "${data[RedisPipe.EVENT]}" to "${channel}" (${data.d?._id})`
        );

        if (subscribers.length === 0) {
            return;
        }

        if (!isSynthetic) {
            const collection = subscribers[0].observableCollection.collection;

            let doc;
            if (data[RedisPipe.EVENT] === Events.REMOVE) {
                doc = data[RedisPipe.DOC];
            } else {
                doc = this.getDoc(collection, subscribers, data);
            }

            // if by any chance it was deleted after it got dispatched
            // doc will be undefined
            if (!doc) {
                return;
            }

            subscribers.forEach(redisSubscriber => {
                try {
                    redisSubscriber.process(
                        data[RedisPipe.EVENT],
                        doc,
                        data[RedisPipe.FIELDS]
                    );
                } catch (e) {
                    debug(
                        `[RedisSubscriptionManager] Exception while processing event: ${e.toString()}`
                    );
                    Meteor._debug(
                        `[RedisSubscriptionManager] Exception while processing event: ${e.toString()}`, e
                    );
                }
            });
        } else {
            subscribers.forEach(redisSubscriber => {
                try {
                    redisSubscriber.processSynthetic(
                        data[RedisPipe.EVENT],
                        data[RedisPipe.DOC],
                        data[RedisPipe.MODIFIER],
                        data[RedisPipe.MODIFIED_TOP_LEVEL_FIELDS]
                    );
                } catch (e) {
                    debug(
                        `[RedisSubscriptionManager] Exception while processing synthetic event: ${e.toString()}`
                    );
                    Meteor._debug(
                        `[RedisSubscriptionManager] Exception while processing synthetic event: ${e.toString()}`, e
                    );
                }
            });
        }
    }

    /**
     * @param collection
     * @param subscribers
     * @param data
     */
    getDoc(collection, subscribers, data) {
        const event = data[RedisPipe.EVENT];
        let doc = data[RedisPipe.DOC];

        if (collection._redisOplog && !collection._redisOplog.protectAgainstRaceConditions) {
            // If there's no protection against race conditions
            // It means we have received the full doc in doc

            return doc;
        }

        const fieldsOfInterest = getFieldsOfInterestFromAll(subscribers);

        if (fieldsOfInterest === true) {
            doc = collection._redisOplogCollectionMethods.findOne(doc._id);
        } else {
            doc = collection._redisOplogCollectionMethods.findOne(doc._id, { fields: fieldsOfInterest });
        }

        return doc;
    }
}

export default new RedisSubscriptionManager();
