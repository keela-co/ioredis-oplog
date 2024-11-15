/**
 * In-Memory configuration storage
 */
let Config = {
    isInitialized: false,
    debug: false,
    overridePublishFunction: true,
    mutationDefaults: {
        pushToRedis: true,
        optimistic: true,
    },
    passConfigDown: false,
    redis: {
        connectTimeout: 3_000,
        socketTimeout: 3_000,
        keepAlive: 5_000,
        noDelay: true,
    },
    globalRedisPrefix: '',
    externalRedisPublisher: false,
    redisExtras: {
        events: {
            connect() {
                console.log('RedisOplog - Established connection to redis.');
            },
            ready() {
                console.log('RedisOplog - Connection to redis is ready');
            },
            end() {
                console.log('RedisOplog - Connection to redis ended');
            },
            reconnecting() {
                console.log('RedisOplog - Re-connecting to redis');
            },
        },
    },
};

export default Config;
