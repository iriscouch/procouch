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

You can also execute specific procouch functions, either with a subcommand or a dedicated program name.

    $ # Just heat the views
    $ procouch heat https://example.iriscouch.com

    $ # Just clean up old view indexes.
    $ procouch clean https://example.iriscouch.com

    $ # Just compact the databases.
    $ procouch compact https://example.iriscouch.com

    $ # Just purge old data
    $ procouch purge https://example.iriscouch.com

    $ # Just prep staged design documents for deployment
    $ procouch deploy https://example.iriscouch.com

## Configuration File

The config file contains one Javascript or JSON object. Keys are the same as the command-line options (documented below) and apply globally.

A typical config, `simple_procouch.conf`:

```javascript
{ "http://localhost:5984": {}
, "https://admin:secret@example.iriscouch.com": {"timeout":60}
}
```

A more advanced config, `advanced_procouch.conf`:

```javascript
{ tasks: ['clean', 'heat'] // No compaction, purging, or prepping, thank you.
, exit: true
, compact_updates: 100000

// Example server-level overrides
, "http://localhost:5984":
  { exit: false // Continuous monitoring and maintenance for my local server.
  , tasks: ['compact', 'clean', 'purge']
  , dbs: ["db_A", "db_B", "db_C"]

  // Example database overrides
  , "/db_A": { "tasks": [] }      // Never do maintenance
  , "/db_B": { "tasks": ['all'] } // Do all maintenance routines
  }

// Another example database-level overrides
, "https://example.iriscouch.com:6984/production_db":
  { tasks: ['compact', 'heat', 'clean', 'purge']
  , security: { admins : {"names":[]     , "roles":["dba", "developer"]}
              , readers: {"names":["bob"], "roles":["users"]}
              }
  , exit: false
  }
}
```


Specify per-server overrides as secondary-level objects, keyed on the server URL. Specify per-database verrides as tertiary objects keyed on the database path, *or* as secondary-level objects keyed on the database URL.

If you do not specify a target on the command-line, Procouch finds targets from the config:

1. Look for a top-level `urls` list.
  * If it exists, target every URL in the list.
  * Otherwise, target every top-level key that looks like a URL (http or https)
1. If the target is a database, manage only that database
1. If the target is a couch, look for a `dbs` list.
  * If it exists, manage only databases from the list
  * Otherwise, manage every database in the couch
1. If any target (couch or database) has a `"skip":true` setting, do not manage it

This allows lots of flexibility to configure couches but temporarily disable managing, or to whitelist or blacklist couches and databases.

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
