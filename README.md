# Professional CouchDB: Fire-and-forget database maintenance

Can you recall reading something about CouchDB views going stale? Do you feel psychic weight because you haven't been compacting regularly? Have you nowhere to turn as "deleted" documents clog up your disk? Do you want to scream if you hear one more word about *the security object*?

Pro CouchDB (or simply *Procouch*) has a simple message for you: **Relax.**

## Objective

Procouch monitors and maintains a CouchDB server. Just run it and never think about it again. Procouch keeps everything like you want it.

* The database is always compacted
* Views are always updated, compacted, and cleaned
* Very old deleted data is purged
* Staging design documents are prepped for deployment
* All of the above just works; but you can configure it for performance or for freshness as needed.

## Is it any good?

Yes.

## How to Pro a Couch

Procouch is available as an NPM package.

    $ npm install -g procouch

Run it from the command-line and relax.

    procouch https://username:password@example.iriscouch.com/

Procouch will continuously monitor the database, performing maintenance activity when needed.

You can also execute specific procouch functions with a subcommand.

    $ procouch https://example.iriscouch.com         # Do everything
    $ procouch heat https://example.iriscouch.com    # Just heat the views
    $ procouch clean https://example.iriscouch.com   # Just clean up old view indexes.
    $ procouch compact https://example.iriscouch.com # Just compact the databases.
    $ procouch purge https://example.iriscouch.com   # Just purge old data
    $ procouch deploy https://example.iriscouch.com  # Just prep staged design documents

## Configuration File

The `--config` file or URL contains one Javascript or JSON object. Keys are the same as the command-line options (documented below) and apply globally.

A typical config, `simple_procouch.conf`:

```javascript
{ "http://localhost:5984": {}
, "https://admin:secret@example.iriscouch.com": {"timeout":60}
}
```

## Global Options

* `--config=<file>` | Read the configuration from `<file>`
* `--log=<level>` | Set log (verbosity) level. Default: `info`
* `--timeout=N` | Assume no response after `N` seconds is a timeout error. Default: 15
* `--exit` | Exit after running once; useful for cron jobs and one-off maintenance. Default: `false`
* `--security=<json>` | Set the database `_security` object to this (be careful about using this globally, it's more useful in a per-db config)

## Procouch Heat

The heater permits only a certain staleness for a database. The options indicate invariants which Procouch will enforce. These will be ignored when run as a one-off command `procouch heat <url>`.

* `--updates=N` | Maximum number of updates before all views are refreshed. Default: `100`
* `--seconds=N` | Maximum elapsed seconds before all views are refreshed. Default: `3600` (1 hour)
* `--nice=<bool>` | Do not heat a database if it is compacting. Default: `true`

## Procouch Compact

Procouch will automatically trigger database compaction after a certain number of updates. These will be ignored when run as a one-off command `procouch compact <url>`.

* `--compact_updates=N` | Number of updates before compaction is triggered again. Default: `5000`

## Advanced Configuration Techniques

Specify per-couch configs as objects keyed on the server URL. Specify per-database configs as inner objects, keyed on the database path, *or* as top-level objects keyed on the database URL. Everything always inherits the settings from its parents.

This is the basic strategy Procouch uses to find targets and configurations:

1. Look for a top-level `urls` list (overridden by command-line URLs)
  * If it exists, target every URL in the list.
  * Otherwise, target every top-level key that looks like a URL
1. Probe the target.
  * If the target is a database, manage only that database
  * If the target is a couch
    1. Look for a config setting, `/_config/iris_couch/procouch`
      * If it does not exist, no problem
      * If it does exist, the returned JSON merge it to the config (lower precedence)
    2. Look for a `dbs` list in its config
      * If `dbs` is a list, target only databases from the list
      * Otherwise, if `dbs` is `"all"` or undefined, target every database in the server.
1. If any target (couch or database) has a `"skip":true` setting, do not manage it

This allows lots of flexibility to configure couches but temporarily disable managing, or to whitelist or blacklist couches and databases.

A more advanced config, `advanced_procouch.conf`:

```javascript
{ tasks: ['clean', 'heat'] // No compaction, purging, or prepping, thank you.
, exit: true
, compact_updates: 100000

// Example server-level overrides, with embedded authentication credentials
, "http://admin:secret@localhost:5984":
  { exit: false // Continuous monitoring and maintenance for my local server.
  , tasks: ['compact', 'clean', 'purge']
  , dbs: ["db_A", "db_B", "db_C"]

  // Example database overrides
  , "/db_A": { "tasks": [] }      // Never do maintenance
  , "/db_B": { "tasks": ['all'] } // Do all maintenance routines
  }

// Example database-level override, with environment variable credntials
, "https://example.iriscouch.com:6984/production_db":
  { username: process.env.COUCH_USER
  , password: process.env.COUCH_PASS
  , tasks: ['compact', 'heat', 'clean', 'purge']
  , security: { admins : {"names":[]     , "roles":["dba", "developer"]}
              , readers: {"names":["bob"], "roles":["users"]}
              }
  , log: 'warn'
  }
}
```
