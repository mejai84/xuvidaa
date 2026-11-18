/* Helpers shared by Xuper Premium's TV, desktop and mobile episode selector.
 * Operates only on catalog metadata; never handles media URLs or credentials.
 */
(function (root, factory) {
  'use strict';
  var helpers = factory();
  if (typeof module === 'object' && module.exports) module.exports = helpers;
  if (root) root.XuperEpisodes = helpers;
})(typeof window !== 'undefined' ? window : null, function () {
  'use strict';
  function listEpisodes(seasons) {
    if (!Array.isArray(seasons)) return [];
    var entries = [], used = Object.create(null);
    seasons.slice(0, 200).forEach(function (season, seasonIndex) {
      if (!season || !Array.isArray(season.episodes)) return;
      var name = String(season.title || ('Temporada ' + (season.number || seasonIndex + 1))).slice(0, 100);
      season.episodes.slice(0, 500).forEach(function (episode, index) {
        if (!episode || typeof episode.id !== 'string' || !episode.id || episode.id.length > 256 || used[episode.id]) return;
        used[episode.id] = true;
        entries.push({
          id: episode.id,
          title: String(episode.title || ('Episodio ' + (episode.number || index + 1))).slice(0, 220),
          number: Number(episode.number) > 0 ? Number(episode.number) : index + 1,
          seasonTitle: name,
          seasonIndex: seasonIndex,
          playbackRestriction: episode.playbackRestriction && episode.playbackRestriction.code === 'UNSUPPORTED_FORMAT'
            ? { code: 'UNSUPPORTED_FORMAT', message: String(episode.playbackRestriction.message || '').slice(0, 700) } : null
        });
      });
    });
    return entries;
  }
  function adjacentEpisode(seasons, currentId, direction) {
    if (direction !== 1 && direction !== -1) return null;
    var episodes = listEpisodes(seasons);
    for (var i = 0; i < episodes.length; i++) {
      if (episodes[i].id === currentId) return episodes[i + direction] || null;
    }
    return null;
  }
  return { listEpisodes: listEpisodes, adjacentEpisode: adjacentEpisode };
});
