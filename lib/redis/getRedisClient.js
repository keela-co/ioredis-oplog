import Redis from 'ioredis';
import Config from '../config';
import { Meteor } from 'meteor/meteor';

// Redis requires two connections for pushing and listening to data
let redisPusher;
let redisListener;

const createRedis = function() {
    const config = Object.assign({}, Config.redis);

    const redis = new Redis(config.url, config).on('error', (err) => {
        console.error(`RedisOplog - An error occurred: \n`, JSON.stringify(err));
    });

    redis.on("connect", function() {    
        var continuousPing = () => redis.ping().then(function(res) {
            setTimeout(continuousPing, 2_000);
         }).catch(console.error);
    
        continuousPing();
    });

    return redis;
}

/**
 * Returns the pusher for events in Redis
 *
 * @returns {*}
 */
export function getRedisPusher() {
    if (!redisPusher) {
        redisPusher = createRedis();
    }

    return redisPusher;
}

/**
 * Returns the listener for events in Redis
 *
 * @param onReady
 * @returns {*}
 */
export function getRedisListener({onReady} = {}) {
    if (!redisListener) {
        redisListener = createRedis();
        
        // we only attach events here
        attachEvents(redisListener, {onReady});
    }

    return redisListener;
}

/**
 *
 * @param client
 * @param onReady
 */
function attachEvents(client, {onReady}) {
    const functions = ['connect', 'ready', 'reconnecting', 'error', 'end'];

    functions.forEach(fn => {
        redisListener.on(fn, Meteor.bindEnvironment(function (...args) {
            if (fn === 'ready' && onReady) {
                onReady();
            }
            if (Config.redisExtras.events[fn]) {
                return Config.redisExtras.events[fn](...args);
            }
        }))
    });
}
