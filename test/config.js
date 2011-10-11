// Procouch invocation and config tests
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

var test = require('tap').test
  , config = require('../lib/config')
  , util = require('util'), I = util.inspect
  , request = require('request')
  ;


test('Couch is up', function(t) {
  request('http://localhost:5984/_session', function(er, resp, body) {
    t.notOk(er);
    t.equal(resp.statusCode, 200, 'Couch is up');
    t.ok(body, 'Session response body');

    var session = JSON.parse(body);
    var userCtx = session.userCtx;
    t.equal(userCtx.name, null, 'Couch admin party name')
    t.equal(userCtx.roles.length, 1, 'Couch admin party role length')
    t.equal(userCtx.roles[0], '_admin', 'Couch admin party roles')

    t.end();
  })
})

test('Invalid configs', function(t) {
  var bad_pairs = [ [''   , 'db'   ]
                  , ['/'  , '/db'  ]
                  , ['///', 'db'   ]
                  , ['/'  , 'db/'  ]
                  , [''   , 'db///']
                  ];

  t.plan(bad_pairs.length * 2);
  bad_pairs.forEach(function(pair, a) {
    var couch = 'http://localhost:5984' + pair[0];
    var db    = '/' + pair[1];
    var full  = couch + db;

    var cfg = { 'argv': [], 'num':a };
    cfg[couch] = {};
    cfg[couch][db] = {'log':'debug'};
    cfg[full] = {'log':'debug'};

    var mod = config.defaults(cfg);
    mod.start(function(er, resp) {
      t.ok(er, "Overlapping URLs return an error: " + JSON.stringify(pair));
      t.ok(er && er.message.match(/^Overlapping/),
           "Overlapping URLs return a useful error message: " + JSON.stringify(pair));
    })
  })
})
