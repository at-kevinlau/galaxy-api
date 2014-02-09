var _ = require('lodash');
var request = require('request');
var Promise = require('es6-promise').Promise;

var db = require('../db');
var settings = require('../settings');
var settings_local = require('../settings_local');
var utils = require('../lib/utils');

// NOTE: In order to generate users with this script, you should first start up
// persona-faker (npm run-script persona-faker) so that we can generate fake
// Persona assertions (instead of flooding the production Persona server with fake users).
// You should also update PERSONA_VERIFICATION_URL in settings_local.js to point to
// this endpoint (ie. http://localhost:9001/verify) so that galaxy-api actually 
// touches this server.
const API_ENDPOINT = 'http://localhost:5000';
const PERSONA_ENDPOINT = 'http://localhost:9001';

const USER_COUNT = 100;
const FAKE_GAMES = [
    {
        name: 'Mario Broskis',
        app_url: 'http://mario.broskis'
    }, 
    {
        name: 'Halo 718',
        app_url: 'http://halo.com'
    },
    {
        name: 'Left 5 Dead',
        app_url: 'http://dead.left'
    }
];

if (settings_local.FLUSH_DB_ON_PREFILL) {
    // FIXME: this doesn't work when the script is called
    // from outside the root directory for some reason
    console.log('flushing db...');
    var client = db.redis();
    client.flushdb(function(){
        client.end();
        run();
    });
} else {
    run();
}

function createUsers() {
    function createUser(email) {
        return new Promise(function(resolve,reject) {
            request.post({
                url: PERSONA_ENDPOINT + '/generate',
                form: {
                    email: email
                }
            }, function(err, resp, body) {
                if (err) {
                    reject('Connection to assertion generator failed');
                    return;
                }
                
                var json_resp = JSON.parse(body);
                resolve({email: email, assertion: json_resp.assertion});
            });
        });
    };

    function login(emailAssertion){
        return new Promise(function(resolve,reject){
            var email = emailAssertion.email;
            var assertion = emailAssertion.assertion;
            request.post({
                url: API_ENDPOINT + '/user/login',
                form: {
                    assertion: assertion,
                    audience: API_ENDPOINT
                }
            }, function(err, resp, body) {
                if (err) {
                    reject('Galaxy login failed.');
                    return;
                }
                
                var json_resp = JSON.parse(body);
                if (json_resp.error) {
                    reject('Galaxy login failed: ' + json_resp.error);
                    return;
                }
                resolve({
                    email: email,
                    token: json_resp.token,
                    username: json_resp.public.username,
                    id: json_resp.public.id
                });
            });
        });
    };

    var promises = [];
    for (var i = 0; i < USER_COUNT; i++){
        promises.push(createUser('test' + i + '@test.com').then(login));
    }
    return Promise.all(promises);
}

function createFriends(users) {
    function sendRequests(user) {
        var recipients = _.sample(users, Math.min(3, USER_COUNT));
        var promises = [];
        _.each(recipients, function(recipient){
            promises.push(sendRequest(user, recipient));
        });
        return Promise.all(promises);
    }

    function sendRequest(user, recipient) {
        return new Promise(function(resolve, reject){
            request.post({
                url: API_ENDPOINT + '/user/friends/request',
                form: {
                    _user: user.token,
                    recipient: recipient.id
                }
            }, function(err, resp, body) {
                if (err) {
                    reject(err);
                    return;
                }
                
                var json_resp = JSON.parse(body);
                if (json_resp.error) {
                    if ((json_resp.error === 'already_friends')
                        || (json_resp.error === 'already_requested')) {
                        console.log('Friend request warning:', json_resp.error);
                        resolve({});
                    } else {
                        reject(json_resp.error);
                    }
                    return;
                }
                
                resolve({
                    user: user,
                    recipient: recipient
                });
            });
        });
    }

    function acceptRequest(friendRequest) {
        return new Promise(function(resolve,reject){
            function done() {
                resolve({
                    user: friendRequest.user,
                    recipient: friendRequest.recipient
                });
            }
            if (!(friendRequest.user && friendRequest.recipient)) {
                // silently ignore acceptable errors
                // TODO: create a mechanism to avoid redundant friend requests
                // (we randomly pick users to friend, so A can friend B, then B can friend A later)
                done();
                return;
            }
            request.post({
                url: API_ENDPOINT + '/user/friends/accept',
                form: {
                    _user: friendRequest.recipient.token,
                    acceptee: friendRequest.user.id
                }
            }, function(err, resp, body) {
                if (err) {
                    reject(err);
                    return;
                }
                
                var json_resp = JSON.parse(body);
                if (json_resp.error) {
                    reject("Friend accept failed: " + json_resp.error)
                    return;
                }
                done();
            });
        });
    }

    var promises = [];
    _.each(users, function(user){
        promises.push(sendRequests(user).then(function(requests){
            return Promise.all(requests.map(acceptRequest));
        }));
    });
    return Promise.all(promises).then(_.flatten);
}

function createGames() {
    var default_params = {
        icons: '128',
        screenshots: 'yes'
    };

    var promises = [];
    _.each(FAKE_GAMES, function(game) {
        promises.push(new Promise(function(resolve, reject) {
            request.post({
                url: API_ENDPOINT + '/game/submit',
                form: _.defaults(game, default_params)
            }, function(err, resp, body) {
                if (err) {
                    reject(err);
                    return;
                }
                resolve(body);
            });
        }).then(JSON.parse));
    });
    return Promise.all(promises);
}

function purchaseGames(userSSAs, gameSlugs) {
    var promises = [];
    _.each(userSSAs, function(user){
        _.each(_.sample(gameSlugs, 2), function(game) {
            promises.push(newPurchase(user, game));
        });
    });

    function newPurchase(user, game) {
        return new Promise(function(resolve, reject) {
            request.post({
                url: API_ENDPOINT + '/user/purchase',
                form: {
                    _user: user,
                    game: game
                }
            }, function(err, resp, body) {
                if (err) {
                    reject(err);
                    return;
                }
                resolve(body);
            });
        });
    }

    return Promise.all(promises);
}

function run() {
    utils.promiseMap({
        users: createUsers(), 
        games: createGames()
    }).then(function(result){
        var gameSlugs = result.games.map(function(json) { return json.slug; });
        var userSSAs = result.users.map(function(user) { return user.token; });

        var purchasePromise = purchaseGames(userSSAs, gameSlugs);
        var friendsPromise = createFriends(result.users);

        return utils.promiseMap({
            friends: friendsPromise,
            purchases: purchasePromise
        });
    }).then(function(result) {
        console.log('created', USER_COUNT, 'users and', Object.keys(FAKE_GAMES).length, 'games');
        // TODO: log some form of useful output
        console.log('also generated purchases and friend requests');
    }).catch(function(err) {
        console.log('error:', err, 'stack trace:', err.stack);
        process.exit(1);
    });
}
