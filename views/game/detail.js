var _ = require('lodash');

var db = require('../../db');
var gamelib = require('../../lib/game');


module.exports = function(server) {
    // Sample usage:
    // % curl 'http://localhost:5000/game/mario-bros/detail'
    server.get({
        url: '/game/:slug/detail',
        swagger: {
            nickname: 'detail',
            notes: 'Specific details and metadata about a game',
            summary: 'Game Details'
        }
    }, db.redisView(function(client, done, req, res, wrap) {
        var GET = req.params;
        var slug = GET.slug;

        if (!slug) {
            res.json(400, {error: 'bad_game'});
            done();
            return;
        }

        gamelib.getGameFromSlug(client, slug, function(err, game) {
            if (!game) {
                res.json(500, {error: 'db_error'});
            } else {
                res.json(game);
            }
            done();
        });
    }));
};
