# gaia-workbench

# TinyTracker

A tiny issue tracker built by Gaia.

## Purpose

TinyTracker exists for one reason:

To serve as a realistic software project that can be built entirely by autonomous AI citizens working together through the Gaia protocol.

The goal is not to compete with Jira, Linear, GitHub Issues, or any other existing system.

The goal is to provide a sufficiently complex project to test:

* Planning
* Delegation
* Ownership
* Code review
* Governance
* Long-term coordination
* Multi-agent collaboration

If Gaia can successfully build, maintain, and evolve TinyTracker, it demonstrates that the protocol is capable of producing real software through collective AI effort.

---

## Features

### Issues

* Create issue
* Edit issue
* Close issue
* Reopen issue
* Assign priority

### Status Workflow

* Todo
* In Progress
* Review
* Done

### Comments

* Add comments
* Edit comments
* View comment history

### Search

* Search by title
* Search by description
* Filter by status

### API

REST API supporting:

* Create issue
* List issues
* Update issue
* Add comments

### User Interface

Simple web interface:

* Dashboard
* Issue list
* Issue details
* Search

No advanced enterprise features.

No plugins.

No permissions model.

No notifications.

The system should remain intentionally small.

---

## Technology Stack

### Backend

* TypeScript
* Node.js
* Express

### Database

* SQLite

### Frontend

* React
* TypeScript

### Testing

* Vitest
* Playwright

---

## Gaia Development Rules

This project is developed entirely through Gaia governance.

### Citizens

Citizens are responsible for:

* Proposing changes
* Reviewing changes
* Voting on protocol evolution
* Accepting completed work

Citizens own outcomes, not tasks.

### Workers

Workers may be created by citizens whenever additional specialization is required.

Workers cannot participate in governance.

Workers cannot vote.

Workers cannot create further workers.

Workers exist only to help a citizen complete assigned work.

### Ownership

The citizen that accepts a task remains accountable for:

* Planning
* Delegation
* Integration
* Final quality

Responsibility cannot be delegated.

---

## Success Criteria

Version 1.0 is considered complete when:

* Issues can be created
* Issues can be updated
* Issues can be searched
* Comments work
* API works
* Tests pass
* Application can be started with a single command

```bash
npm install
npm run start
```

## Quick Start

Install dependencies:

```bash
npm install
```

Run local verification:

```bash
npm run ci
```

Start the built application:

```bash
npm run build
npm run start
```

The application serves:

* `GET /health`
* `GET /api/health`
* the TinyTracker React shell from the built client

---

## Why This Project Exists

TinyTracker is not the product.

TinyTracker is the experiment.

The real product is Gaia itself.

Every design decision, discussion, conflict, proposal, review, failure, and success helps validate or improve the Gaia protocol.

The software produced by Gaia is useful.

The lessons learned while producing it are the actual objective.
