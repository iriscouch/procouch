// Utility code
//
// Copyright 2011 Iris Couch
//
//    Licensed under the Apache License, Version 2.0 (the "License");
//    you may not use this file except in compliance with the License.
//    You may obtain a copy of the License at
//
//        http://www.apache.org/licenses/LICENSE-2.0
//
//    Unless required by applicable law or agreed to in writing, software
//    distributed under the License is distributed on an "AS IS" BASIS,
//    WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
//    See the License for the specific language governing permissions and
//    limitations under the License.

var assert = require('assert')
  , request_api = require('request')
  , defaultable = require('defaultable')
  ;

require('defaultable')(module,
  { 'request_timeout_ms': 60000
  }, function(module, exports, DEFS, require) {


var JS   = exports.JS   = JSON.stringify;
var JP   = exports.JP   = JSON.parse;
var JDUP = exports.JDUP = function(val) { return JP(JS(val)) };

exports.join = join_and_fix_slashes;
exports.is_url = is_url;
exports.trim   = trim;
exports.normal = normal;
exports.splice = splice;
exports.flatten = flatten;
exports.nodupes = nodupes;
exports.request = request;
exports.req_json = req_json;
exports.req_couch = req_couch;


function join_and_fix_slashes() {
  return Array.prototype.map.apply(arguments, [trim]).join('/');
}

function trim(arg) {
  return arg.replace(/^\/+/, "").replace(/\/+$/, "");
}

var url_re = /^(https?:\/\/)(.+)$/;

function is_url(str) {
  return url_re.test(str);
}

function normal(url) {
  var match = url.match(url_re);
  if(!match)
    throw new Error('Not a URL: ' + url);

  url = match[2].split(/\/+/).join('/');
  return trim(match[1] + url);
}

function splice(obj, tester, cb) {
  var pred = tester;
  if(typeof pred != 'function')
    pred = function(X) { return tester.test(X) }

  var fails = {}, matches = {};
  Object.keys(obj).forEach(function(key) {
    if(pred(key))
      matches[key] = obj[key];
    else
      fails[key] = obj[key];
  })

  return cb(fails, matches);
}

function flatten(arr) {
  return arr.reduce(function(state, val) {
    if(Array.isArray(val))
      val = flatten(val);
    else
      val = [val];

    return state.concat(val);
  }, [])
}

function nodupes(arr) {
  var vals = {};
  arr.forEach(function(elem) { vals[elem] = 1 })
  return Object.keys(vals);
}

function req_couch(opts, callback) {
  assert.ok(callback);

  if(process.env.couch_proxy)
    opts.proxy = process.env.couch_proxy;

  return req_json(opts, function(er, resp, result) {
    if(er)
      return callback(er, resp, result);

    if((resp.statusCode < 200 || resp.statusCode > 299) && result.error)
      // HTTP worked, but Couch returned an error.
      return callback(new Error("CouchDB error: " + JS(result)), resp, result);

    // No problems.
    return callback(null, resp, result);
  })
}


function req_json(opts, callback) {
  assert.ok(callback);

  if(typeof opts == 'string')
    opts = {'uri':opts};
  else
    opts = JDUP(opts);

  opts.followRedirect = false;
  opts.headers = opts.headers || {};
  opts.headers['accept'] = opts.headers['accept'] || 'application/json';

  opts.method = opts.method || 'GET';
  if(opts.method !== 'GET')
    opts.headers['content-type'] = 'application/json';

  return request(opts, function(er, resp, body) {
    if(!er) {
      try         { body = JSON.parse(body) }
      catch(j_er) { // Query worked but JSON was invalid (e.g. not a couch URL).
                    er = new Error("Response was not JSON (or not valid)") }
    }
    return callback(er, resp, body);
  })
}


function request(opts, callback) {
  assert.ok(callback);

  var in_flight = null;
  var timed_out = false;
  var timer = setTimeout(on_timeout, DEFS.request_timeout_ms);
  function on_timeout() {
    timed_out = true;
    var msg = 'Timeout: ' + JS(opts);
    //LOG.warn(msg);

    if(in_flight && in_flight.end)
      in_flight.end();

    if(in_flight && in_flight.response && in_flight.response.destroy)
      in_flight.response.destroy();

    return callback(new Error(msg));
  }

  in_flight = request_api(opts, function(er, resp, body) {
    clearTimeout(timer);
    if(timed_out) {
      //LOG.debug('Ignoring timed-out response: ' + opts.uri);
      return;
    }
    return callback(er, resp, body);
  })

  return in_flight;
}

}) // defaultable
