/* CouchDB view heater
 *
 * TODO:
 *   * Detect when the signature changes and run /db/_view_cleanup
 *   * Some simple heuristic for when enough updates have happened and run /db/_compact/_design/ddoc
 */

var sys = require('sys')
  , lib = require('lib')
  , querystring = require('querystring')
  , couch_changes = require('lib/couch_changes')
  ;

var LOG = lib.logging.getLogger('view_heater');

exports.heat = function(opts) {
  var db = opts.db;
  var clean_db = db.replace(/^(https?:\/\/)[^:]+:[^@]+@(.*)$/, '$1$2'); // Scrub username and password
  //var LOG = lib.logging.getLogger('view_heater.' + clean_db);
  var max_age = opts.max_age || (3 * 60 * 1000); // ms
  var max_seq = opts.max_seq || 100;
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

    var timed_out = function() {
      LOG.debug('Time threshold met (' + max_age + 'ms); updating ' + clean_db);
      update_db(heater_state, function(er, new_latest) {
        if(er)
          lib.thr0w(er);

        LOG.debug('Time-based update complete on "' + clean_db + '": ' + JSON.stringify(new_latest));
        heater_state.seq = new_latest.seq;
        heater_state.time = new_latest.time;

        heater_state.timer = null;
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
    couch_changes.follow({db:db, heartbeat:55000, include_docs:false, since:latest.seq}, function(change) {
      //LOG.debug("Got a change: " + JSON.stringify(change));
      if(heater_state.seq + max_seq <= change.seq) {
        LOG.debug("Sequence threshold met (" + max_seq + "); updating " + clean_db);
        update_db(heater_state, function(er, new_latest) {
          if(er)
            lib.thr0w(er);

          LOG.debug('Sequence-based update complete on ' + clean_db + ': ' + JSON.stringify(new_latest));
          heater_state.seq = new_latest.seq;
          heater_state.time = new_latest.time;
          new_timeout();
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
    var completed_ddoc = function(ddoc, all_ddocs) {
      ddocs_done += 1;
      if(ddocs_done === all_ddocs.length) {
        LOG.debug("Completed all ddocs for " + db_name);

        // XXX: This could lie to the caller because Couch may have been given a break due to compaction, updates, etc.
        return cb && cb(null, {seq:db_update_seq, time:query_timestamp});
      }
    }

    LOG.debug("Updating all ddocs in " + db_name);
    try {
      forEach_ddoc(db, function(er, result, a, all_ddocs) {
        if(er)
          lib.thr0w(er);

        var ddoc = result.ddoc
          , info = result.info
          , ddoc_name = [db_name, ddoc._id].join('/');

        LOG.debug('Processing ddoc ' + (a+1) + '/' + all_ddocs.length + ': ' + ddoc_name + "\n" + sys.inspect(info));

        if(info.update_seq > last_processed_seq)
          return(cb && cb(new Error("Woa! DDoc " + ddoc_name + " update_seq=" + info.update_seq + " but " + db_name + " update_seq=" + db_update_seq)));

        if(info.update_seq == last_processed_seq) {
          LOG.debug("No need to query " + ddoc_name + " because it is up-to-date with db seq: " + db_update_seq);
          return completed_ddoc(ddoc, all_ddocs);
        }

        if(info.compact_running) {
          LOG.debug("Going easy on " + ddoc_name + " because view compaction is running");
          return completed_ddoc(ddoc, all_ddocs);
        }

        if(info.updater_running) {
          LOG.debug("Going easy on " + ddoc_name + " because it is already updating");
          return completed_ddoc(ddoc, all_ddocs);
        }

        if(info.waiting_clients) {
          LOG.debug("Going easy on " + ddoc_name + " because other clients are waiting");
          return completed_ddoc(ddoc, all_ddocs);
        }

        // Pick a random view just on account of because.
        var view_names = Object.keys(ddoc.views || {}).sort(function() { return Math.round(Math.random()) - 0.5 });
        if(view_names.length == 0) {
          LOG.debug("No views for ddoc: " + ddoc_name);
        } else {
          var view_name = view_names[0];
          var view = [db, ddoc._id, '_view', view_name, '?limit=0'].join('/');
          lib.req_json({uri:view}, function(er, res, body) {
            if(er)
              lib.thr0w(er);

            // At this point it is guaranteed that the view is at least up to db_update_seq (perhaps furter).
            LOG.debug('Views for ' + ddoc_name + ' are at least up to seq ' + db_update_seq);
            return completed_ddoc(ddoc, all_ddocs);
          })
        }
      })
    } catch (e) {
      LOG.error("Error during ddoc update: " + db_name);
      return(cb && cb(e));
    }
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
