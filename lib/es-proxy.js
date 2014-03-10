/**
 * Proxies the request to elasticsearch
 * node-http-proxy worked really well until it met elasticsearch deployed on cloudfoundry
 * hence this small proxy and naive proxy based on:
 * http://www.catonmat.net/http-proxy-in-nodejs/
 */
var http = require('http');
var config = require('../config');
var kibanaIndex = require('./kibana-index');

function proxyRequest(request, response, host, port, user, password, getProxiedRequestPath, isUI) {
  var filteredHeaders = {};
  Object.keys(request.headers).forEach(function(header) {
    if (header === 'host') {
      //most necessary:
      filteredHeaders[header] = host;
    } else if (header !== 'cookie' &&
        (isUI === true || (header !== 'referer' &&
               header !== 'user-agent' && header !== 'accept-language'))) {
      //avoid leaking unecessay info and save some room
      filteredHeaders[header] = request.headers[header];
    }
  });
  if (user) {
    var auth = 'Basic ' + new Buffer(user + ':' + password).toString('base64');
    filteredHeaders.authorization = auth;
  }

  var options =  {
    path: getProxiedRequestPath(request),
    method: request.method,
    hostname: host,
    port: port,
    headers: filteredHeaders
  };
  if (user) {
    options.auth = password ? user + ':' + password : user;
  }

  var proxyReq = http.request(options);

  proxyReq.addListener('response', function(proxyResp) {
    var http10 = request.httpVersionMajor === 1 && request.httpVersionMinor < 1;
    if(http10 && proxyResp.headers['transfer-encoding'] !== undefined){
      //filter headers
      var headers = proxyResp.headers;
      delete proxyResp.headers['transfer-encoding'];
      var buffer = "";

      //buffer answer
      proxyResp.addListener('data', function(chunk) {
        buffer += chunk;
      });
      proxyResp.addListener('end', function() {
        headers['Content-length'] = buffer.length;//cancel transfer encoding "chunked"
        response.writeHead(proxyResp.statusCode, headers);
        response.write(buffer, 'binary');
        response.end();
      });
    } else {
      //send headers as received
      response.writeHead(proxyResp.statusCode, proxyResp.headers);

      //easy data forward
      proxyResp.addListener('data', function(chunk) {
        response.write(chunk, 'binary');
      });
      proxyResp.addListener('end', function() {
        response.end();
      });
    }
  });

  //proxies to SEND request to real server
  request.addListener('data', function(chunk) {
    proxyReq.write(chunk, 'binary');
  });
  request.addListener('end', function() {
    proxyReq.end();
  });
}

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

var defaultAllowedPatterns = [
  regexpForUrlSegment('_nodes'),
]

exports.configureESProxy = function(app, esHost, esPort, esUser, esPassword) {
  app.use("/__es", function(request, response, next) {

    // basic auth only
    var user = request.user;

    var groups = config.users_groups[user] || [];
    var allowedAliases = groups.map(function(group) {
      return config.groups_aliases[group] || [];
    }).reduce(function(mem, aliases) {
      return mem.concat(aliases);
    }, []).map(function(alias) {
      return regexpForUrlSegment(alias);
    });

    var indexPattern = regexpForUrlSegment(kibanaIndex.getForRequest(request));

    var allowedPatterns = defaultAllowedPatterns.concat(allowedAliases).
      concat([indexPattern]);

    console.log("user", user, "requesting", request.url);

    var allowed = (user == "admin") || allowedPatterns.some(function(pattern) {
      var matches = pattern.test(request.url);
      console.log("  ", request.url, pattern, matches);
      return matches;
    });

    if (allowed) {
      proxyRequest(request, response, esHost, esPort, esUser, esPassword,
                   function getProxiedRequestPath(request) {
                     return request.url;
                   });
    } else {
      var e = new Error('not allowed access to ' + request.url);
      e.status = 403;
      next(e);
    }
  });
  app.use("/_plugin", function(request, response, next) {
    proxyRequest(request, response, esHost, esPort, esUser, esPassword,
      function getProxiedRequestPath(request) {
        return request.originalUrl;
      }, true);
  });
};
