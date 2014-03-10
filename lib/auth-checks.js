var config = require('../config');
var kibanaIndex = require('./kibana-index');


/**
 * return a regexp that will match a url path segment, i.e for 'foo':
 *  /foo     -> true
 *  /bar/foo -> false
 *  /foo/bar -> true
 *  /foobar  -> false
 */
function regexpForUrlSegment(segment) {
  return new RegExp("^/" + segment + "(?:/|$)");
}

/**
 * regular expressions to allow for all users
 */
var defaultAllowedPatterns = [
  regexpForUrlSegment('_nodes'),
]

/**
 * checks the url to see if it matches an index request
 * from the set of indices the user is allowed to access
 */
function checkAllowedIndices(request) {

  if (request.method != 'GET' || request.method != 'HEAD')  {
    return false;
  }

  var user = request.user;
  var groups = config.users_groups[user] || [];

  var allowedIndices = groups.map(function(group) {
    return config.groups_indices[group] || [];
  }).reduce(function(mem, indices) {
    return mem.concat(indices);
  });

  var indexMatch = /^\/([^$\/]+)/.exec(request.url) || ['', ''];
  var indicesRequested = indexMatch[1].split(',')

  return indicesRequested.every(function(segment) {
    return allowedIndices.some(function(index) {
      var datePattern = /%date-pattern%/;
      if (index.search(datePattern) != -1) {
        // FIXME this is a bit wasteful - these could be converted to regexp
        // on startup, rather than on each comparison
        var indexPattern = new RegExp(index.replace(datePattern, '[0-9\.]+'));
        return indexPattern.test(segment);
      } else {
        return index == segment;
      }
    });
  });
}

/**
 * checks patterns that all users can access as well as kibana index pattern
 */
function checkStandardPatterns(request) {
  var kibIndexPattern = regexpForUrlSegment(kibanaIndex.getForRequest(request));
  var allowedPatterns = defaultAllowedPatterns.concat([kibIndexPattern]);

  return allowedPatterns.some(function(pattern) {
    var matches = pattern.test(request.url);
    return matches;
  });
}

/**
 * allows admin to see everything
 */
function checkAdmin(request) {
  return request.user == 'admin';
}

exports.checks = [
  checkAdmin,
  checkStandardPatterns,
  checkAllowedIndices,
];

exports.checkRequest = function(request) {
  return exports.checks.some(function(checkFunc) {
    return checkFunc(request);
  });
};
