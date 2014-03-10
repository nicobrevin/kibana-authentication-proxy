var config = require('../config')


function indexNameForUser(user) {
  var raw_index = config.kibana_es_index;
  return raw_index.replace(/%user%/gi, user);
}

function getForRequest(request) {
  var raw_index = config.kibana_es_index;
  var user_type = config.which_auth_type_for_kibana_index;

  var user;
  if (raw_index.indexOf('%user%') > -1) {
    if (user_type === 'google') {
      user = request.googleOauth.id;
    } else if (user_type === 'basic') {
      user = request.user;
    } else if (user_type === 'cas') {
      user = request.session.cas_user_name;
    } else {
      user = 'unknown';
    }
    return indexNameForUser(user)
  } else {
    return raw_index;
  }
}


exports.getForRequest = getForRequest;
