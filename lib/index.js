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

var JS   = exports.JS   = JSON.stringify;
var JP   = exports.JP   = JSON.parse;
var JDUP = exports.JDUP = function(val) { return JP(JS(val)) };

exports.join = join_and_fix_slashes;
exports.is_url = is_url;
exports.trim   = trim;
exports.normal = normal;
exports.splice = splice;


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
