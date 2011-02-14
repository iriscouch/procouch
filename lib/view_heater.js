/* CouchDB view heater
 *
 * TODO:
 *   * Detect when the signature changes and run /db/_view_cleanup
 *   * Some simple heuristic for when enough updates have happened and run /db/_compact/_design/ddoc
 */

var fs = require('fs')
  , sys = require('sys')
  , lib = require('../lib')
  , assert = require('assert')
  , querystring = require('querystring')
  , couch_changes = require('../lib/couch_changes')
  ;

var LOG = lib.logging.getLogger('view_heater');

function heat_couch(opts) {
  var couch = opts.couch
    , uri = lib.join(couch, '/_all_dbs');

  var heated_dbs = {};
  var check_interval = opts.refresh || 1 * 60 * 60 * 1000; // in ms, default=1h

  LOG.debug("Heating couch: " + couch);

  function probe_dbs() {
    lib.req_couch({uri:uri}, function(er, res, body) {
      try {
        if(er)
          return LOG.error("Failure checking for DBs: " + uri, er);

        if(body.length == 0)
          LOG.info("No databases");

        body.forEach(function(db_name) {
          var db_url = lib.join(couch, db_name);

          if(db_name in heated_dbs) {
            LOG.debug("Already heating: " + db_url);
          } else {
            LOG.debug("Heating new DB: " + db_url);

            heated_dbs[db_name] = true;
            var db_opts = JSON.parse(JSON.stringify(opts));
            db_opts.db = db_url;

            var expected_security = opts.security[db_name];
            if(!expected_security) {
              return heat_db(db_opts);
            } else {
              var sec_url = lib.join(db_url, '/_security');
              LOG.debug("Setting _security: " + sec_url);

              var seq_req = { uri: lib.join(db_url, '/_security')
                            , method: 'PUT'
                            , body: JSON.stringify(expected_security)
                            };

              lib.req_couch(seq_req, function(er, res, body) {
                if(er)
                  throw er;
                if(!body.ok)
                  throw new Error("Unexpected _security response: " + JSON.stringify(body));

                LOG.debug("Set _security for " + db_name);
                return heat_db(db_opts);
              })
            }
          }
        })
      } finally {
        setTimeout(probe_dbs, check_interval);
      }
    })
  }

  return probe_dbs();
}

function heat_db(opts) {
  var db = opts.db;
  var clean_db = db.replace(/^(https?:\/\/)[^:]+:[^@]+@(.*)$/, '$1$2'); // Scrub username and password

  //var log = opts.log || lib.logging.getLogger('view_heater.' + clean_db);

  var max_age = opts.age;
  var max_seq = opts.seq;
  LOG.info("Heating views on " + clean_db + " at most " + max_age + "ms or " + max_seq + " changes");

  var update_db = function(latest_known, cb) {
    ping_db(db, latest_known.seq, function(er, new_latest) {
      if(er)
        return cb && cb(er);

      LOG.debug('Latest DB update for ' + clean_db + ': ' + JSON.stringify(new_latest));
      return cb && cb(null, new_latest);
    })
  }

  LOG.debug("First update: " + clean_db);
  update_db({seq:0, time:new Date('1981')}, function(er, latest) {
    if(er)
      lib.thr0w(er);

    // Great. Now start watching changes and also watch the clock, and whichever happens first, ping the db again.
    LOG.debug("Initial DB update complete, starting sequence and timer watchers: " + clean_db);

    var heater_state = latest;

    // Autocompaction
    var last_compaction_seq = latest.seq;
    function compact() {
      var updates_since_compaction = heater_state.seq - last_compaction_seq;
      if(updates_since_compaction < opts.compact) {
        LOG.debug("No compaction for only " + updates_since_compaction + " updates: " + clean_db);
      } else {
        LOG.debug("Compacting after " + updates_since_compaction + " updates: " + clean_db);
        lib.req_couch({method:'POST', uri:lib.join(db, '/_compact')}, function(er, res, body) {
          if(er) throw er;

          assert.equal(res.statusCode, 202, "Did not get expected 202 response compacting " + clean_db + ": " + JSON.stringify(body));
          assert.ok(body.ok, "Unexpected response compacting " + clean_db + ": " + JSON.stringify(body));

          LOG.debug("Compaction complete; sending view cleanup: " + clean_db);
          lib.req_couch({method:'POST', uri:lib.join(db, '/_view_cleanup')}, function(er, res, body) {
            if(er) throw er;

            assert.equal(res.statusCode, 202, "Did not get expected 202 response cleaning " + clean_db + ": " + JSON.stringify(body));
            assert.ok(body.ok, "Unexpected response cleaning " + clean_db + ": " + JSON.stringify(body));

            LOG.info("Began compaction: " + clean_db);
            last_compaction_seq = heater_state.seq;
          })
        })
      }
    }

    var timed_out = function() {
      LOG.debug('Time threshold met (' + max_age + 'ms); updating ' + clean_db);
      update_db(heater_state, function(er, new_latest) {
        if(er)
          lib.thr0w(er);

        LOG.debug('Time-based update complete on "' + clean_db + '": ' + JSON.stringify(new_latest));
        heater_state.seq = new_latest.seq;
        heater_state.time = new_latest.time;

        heater_state.timer = null;
        compact();

        new_timeout();
      })
    }

    var new_timeout = function() {
      if(heater_state.timer) {
        clearTimeout(heater_state.timer);
        heater_state.timer = null;
        LOG.debug('Cleared old heater timer: ' + clean_db);
      }

      var time_since_query = (new Date) - heater_state.time;
      var ms_until_next_timeout = max_age - time_since_query;
      heater_state.timer = setTimeout(timed_out, ms_until_next_timeout);
      LOG.debug('Set new heater timer: ' + clean_db);
    }

    // And kick off the first timer, which will re-set itself as needed.
    new_timeout();

    // Also begin following changes for seq-based updates.
    var updating_for_seq = false;
    couch_changes.follow({db:db, heartbeat:55000, include_docs:false, since:latest.seq}, function(change) {
      //LOG.debug("Got a change: " + JSON.stringify(change));
      if(updating_for_seq) {
        //LOG.debug("Ignoring seq update since one is in progress: " + change.seq);
        return;
      }

      if(heater_state.seq + max_seq <= change.seq) {
        LOG.debug("Sequence threshold met (" + max_seq + "); updating " + clean_db);

        if(heater_state.timer) {
          clearTimeout(heater_state.timer);
          heater_state.timer = null;
        }

        updating_for_seq = true;
        update_db(heater_state, function(er, new_latest) {
          try {
            if(er)
              lib.thr0w(er);

            LOG.debug('Sequence-based update complete on ' + clean_db + ': ' + JSON.stringify(new_latest));
            heater_state.seq = new_latest.seq;
            heater_state.time = new_latest.time;

            compact();
            new_timeout();
          } finally {
            updating_for_seq = false;
          }
        })
      }
    })

    LOG.debug("Began changes follower since " + latest.seq + ": " + clean_db);
  })
}

function ping_db(db, last_processed_seq, cb) {
  var query_timestamp = new Date();

  lib.req_json({uri:db}, function(er, res, body) {
    if(er || body.error)
      return cb && cb(er || body);

    var db_name = '/' + body.db_name;
    if(!db_name)
      return cb && cb(new Error("Bad return on DB query: " + db));

    var db_update_seq = body.update_seq;
    if(db_update_seq < last_processed_seq)
      return cb && cb(new Error("Woa! Update_seq reduced from " + last_processed_seq + " to " + db_update_seq));

    if(db_update_seq == last_processed_seq) {
      LOG.debug("No updates to " + db_name + ", still on seq " + db_update_seq);
      return cb && cb(null, {seq:db_update_seq, time:query_timestamp});
    }

    if(body.compact_running) {
      LOG.debug("Going easy on " + db_name + " because compaction is running");
      return cb && cb(null, {seq:db_update_seq, time:query_timestamp});
    }

    var ddocs_done = 0;
    var completed_ddoc = function(ddoc, all_ddocs_count) {
      ddocs_done += 1;
      if(ddocs_done === all_ddocs_count) {
        LOG.debug("Completed all ddocs for " + db_name);

        // XXX: This could lie to the caller because Couch may have been given a break due to compaction, updates, etc.
        return cb && cb(null, {seq:db_update_seq, time:query_timestamp});
      }
    }

    var aborted = false;

    LOG.debug("Updating all ddocs in " + db_name);
    forEach_ddoc(db, function(er, result, a, all_ddocs) {
      if(aborted) {
        LOG.debug("This loop has been aborted");
        return;
      }

      if(er && er.error == 'no_ddocs') {
        LOG.debug('Database has no ddocs; nothing to do: ' + db_name);
        return completed_ddoc({}, 1);
      }

      if(er) {
        LOG.error("Error during ddoc update: " + db_name);
        aborted = true;
        return(cb && cb(er));
      }

      var ddoc = result.ddoc
        , info = result.info
        , ddoc_name = [db_name, ddoc._id].join('/');

      LOG.debug('Processing ddoc ' + (a+1) + '/' + all_ddocs.length + ': ' + ddoc_name + "\n" + sys.inspect(info));

      if(info.update_seq > last_processed_seq)
        return(cb && cb(new Error("Woa! DDoc " + ddoc_name + " update_seq=" + info.update_seq + " but " + db_name + " update_seq=" + db_update_seq)));

      if(info.update_seq == last_processed_seq) {
        LOG.debug("No need to query " + ddoc_name + " because it is up-to-date with db seq: " + db_update_seq);
        return completed_ddoc(ddoc, all_ddocs.length);
      }

      if(info.compact_running) {
        LOG.debug("Going easy on " + ddoc_name + " because view compaction is running");
        return completed_ddoc(ddoc, all_ddocs.length);
      }

      if(info.updater_running) {
        LOG.debug("Going easy on " + ddoc_name + " because it is already updating");
        return completed_ddoc(ddoc, all_ddocs.length);
      }

      if(info.waiting_clients) {
        LOG.debug("Going easy on " + ddoc_name + " because other clients are waiting");
        return completed_ddoc(ddoc, all_ddocs.length);
      }

      // Pick a random view just on account of because.
      var view_names = Object.keys(ddoc.views || {}).sort(function() { return Math.round(Math.random()) - 0.5 });
      if(view_names.length == 0) {
        LOG.debug("No views for ddoc: " + ddoc_name);
      } else {
        var view_name = view_names[0];
        var view = [db, ddoc._id, '_view', view_name, '?limit=1'].join('/');
        lib.req_json({uri:view}, function(er, res, body) {
          if(er)
            lib.thr0w(er);

          // At this point it is guaranteed that the view is at least up to db_update_seq (perhaps furter).
          LOG.info('Views for ' + ddoc_name + ' are at least up to seq ' + db_update_seq);
          return completed_ddoc(ddoc, all_ddocs.length);
        })
      }
    })
  })
}

function forEach_ddoc(db, cb) {
  if(!cb) lib.thr0w("foreach_ddoc must supply a callback");

  var startkey = JSON.stringify("_design/");
  var endkey   = JSON.stringify("_design0");
  var query = querystring.stringify({include_docs:'true', startkey:startkey, endkey:endkey});

  lib.req_json({uri:db + '/_all_docs?' + query}, function(er, res, body) {
    if(er || body.error)
      return(cb && cb(er || body));

    if(body.rows.length == 0)
      return cb && cb({error:"no_ddocs"});

    //LOG.debug("each_ddoc got: " + sys.inspect(body));
    body.rows.forEach(function(row, i, rows) {
      var ddoc = row.doc;
      lib.req_json({uri:db + '/' + ddoc._id + '/_info'}, function(er, res, body) {
        if(er || body.error)
          return(cb && cb(er || body));

        cb && cb(null, {ddoc:ddoc, info:body}, i, rows);
      })
    })
  })
}

module.exports = {"heat_couch":heat_couch, "heat_db":heat_db};

if(process.argv[1] === module.filename) {
  var argv = require('optimist').demand([])
                                .default('all', false)
                                .default('age', 3 * 60 * 1000) // 3 minutes in ms
                                .default('seq', 100)
                                .default('compact', 2000)
                                .default('level', 'debug')
                                .argv;

  if(argv.config) {
    var fd = fs.openSync(argv.config, 'r');
    var config = new Buffer(4096);
    var read = fs.readSync(fd, config, 0, 4096);

    assert.ok(read > 0, "Error reading config: " + argv.config);
    assert.ok(read < 4096, "Config file too big: " + argv.config);

    config = config.toString('utf8', 0, read);
    var getter = new Function('obj', 'return (' + config + ')');
    config = getter();

    LOG.info("Config file: " + argv.config);
    for (var key in config)
      argv[key] = argv[key] || config[key];
  }

  assert.ok(argv.couch, 'Must provide "--couch" parameter');
  assert.ok(argv.db || argv.all, "Must provide --db=some_db or --all");

  if(argv.user && argv.pass) {
    var prefix = encodeURIComponent(argv.user) + ':' + encodeURIComponent(argv.pass);
    argv.couch = argv.couch.replace(/^(https?:\/\/)(.*)$/, "$1" + prefix + '@$2');
  }

  LOG.setLevel(argv.level);

  if(argv.db) {
    // Heat one database.
    argv.db = lib.join(argv.couch, argv.db);
    return heat_db(argv);
  } else if(argv.all) {
    return heat_couch(argv);
  }
}
