# 👥 Using kaiZEN (Personal + Groups)

kaiZEN is **personal-first**.

- **Personal mode:** your data is stored under your user key.
- **Group mode:** join or create a group to share **group goals**, **wins**, and **members**.

## Core concepts

- **Identity**: kaiZEN uses a display name (stored locally) and a normalized key for storage paths.
- **Scope**:
  - `personal` → `users/{userKey}/...`
  - `group` → `groups/{code}/...`
- **Legacy compatibility**: older data may live under `families/{code}/...` and can still be read.

## How to use the app

### Start personal

1. Open the app
2. Choose **Personal**
3. Enter your name

You can now track habits, goals, wins, and reflections.

### Join a group

1. Open the app
2. Choose **Join Group**
3. Enter the group code and your name

### Create a group

1. Open the app
2. Choose **Create Group**
3. Optionally set a group name, then create
4. Share the code with others

## What syncs in a group

- Group goals (assignee = `group`)
- Group wins
- Group members list

Personal items remain under your personal scope.

## Privacy note

This project uses Firestore for realtime sync. If you’re hosting your own instance, review your Firestore rules and project settings to match your desired privacy model.
