var auth = require('../../lib/auth');
var db = require('../../db');


module.exports = function(server) {
    // Sample usage:
    // % curl -X POST 'http://localhost:5000/user/purchase' -d 'user=ssatoken&game=9'
    server.post({
        url: '/user/purchase',
        swagger: {
            nickname: 'purchase',
            notes: 'Record that a user has purchased this game',
            summary: 'Purchase game'
        },
        validation: {
            user: {
                description: 'User (ID or username slug)',
                isRequired: true
            },
            game: {
                description: 'Game (ID or slug)',
                isRequired: true
            }
        }
    }, function(req, res) {
        var POST = req.params;

        // TODO: Accept ID *or* slug.
        var user = POST.user;
        var email;
        if (!user || !(email = auth.confirmSSA(user))) {
            res.json(403, {error: 'bad_user'});
        }
        // TODO: Change email to user ID.

        var game = POST.game;
        if (!game) {
            res.json(403, {error: 'bad_game'});
        }

        var redisClient = db.redis();
        redisClient.sadd('gamesPurchased:' + email, game, function(err) {
            if (err) {
                res.json(500, {error: 'internal_db_error'});
                return;
            }
            redisClient.end();
            res.json({success: true});
        });
    });
};
