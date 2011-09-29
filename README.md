# The CouchDB view heater, auto-compactor, and auto-purger

Can you recall reading something about CouchDB views going stale?

Did somebody once tell you to remember to clean your views? But now you've forgotten.

Do you vaguely recall warnings about *database contraction*? Or was it *liquefaction*?

And, Jesus H. Christ, if you hear one more word about *the security object*, you're going to scream!

The security object.

### AAAAaaaaaaahhhhhhh!

Pro CouchDB (or simply *Procouch*), on the other hand, says: **Relax.**

## Objective

Procouch monitors a CouchDB server, ensuring everything is always like you want it:

* The database is always compacted
* Views are always up-to-date
* Views are always compacted
* Old views are cleaned up
* All of the above are configurable. You can tune for performance or for freshness.

## Objective

Procouch permits only a certain staleness for CouchDB. You just run it and never think about it again. Or, if you like, you can configure its tolerances for your couch.

For each database, Procouch maintains several invariants:

* The `_security` object never deviates from what's expected
* Maximum number of updates before all views are refreshed
* Maximum elapsed time before all views are refreshed
* Maximum number of updates before the database is compacted

## How to Pro a Couch

Install Procouch via NPM:

    npm -g install pro_couchdb

Next, run it from the command-line and bask in the warmth.

    procouch https://username:password@example.iriscouch.com/
