# Professional CouchDB: Fire-and-forget database maintenance

Can you recall reading something about CouchDB views going stale? Do you feel psychic weight because you haven't been compacting regularly? Have you nowhere to turn as "deleted" documents clog up your disk? Do you want to scream if you hear one more word about *the security object*?

Pro CouchDB (or simply *Procouch*) has a simple message for you: **Relax.**

## Objective

Procouch monitors and maintains a CouchDB server. Just run it and never think about it again. Procouch keeps everything like you want it.

* The database is always compacted
* Views are always fresh, compacted, and cleaned
* Very old deleted data is purged
* All of the above just works; but you can configure it for performance or for freshness as needed.

## Is it any good?

Yes.

## How to Pro a Couch

Procouch is available as an NPM package.

    $ npm install -g procouch

Run it from the command-line and relax.

    procouch https://username:password@example.iriscouch.com/

Procouch will continuously monitor the database, performing maintenance activity when needed.

You can also execute specific procouch functions by supplying a subcommand. After executing, the program will exit. This can be useful for cron jobs.

    procouch heat https://example.iriscouch.com    # Just heat the views
    procouch clean https://example.iriscouch.com   # Just cleanup old indexes
    procouch compact https://example.iriscouch.com # Just compact the databases
    procouch purge https://example.iriscouch.com   # Just purge old data
    procouch deploy https://example.iriscouch.com  # Just deploy staged design documents

## Objectives

Procouch permits only a certain staleness for CouchDB. Just run it and never think about it again.

For each database, Procouch maintains several invariants:

* The `_security` object never deviates from what's expected
* Maximum number of updates before all views are refreshed
* Maximum elapsed time before all views are refreshed
* Maximum number of updates before the database is compacted
