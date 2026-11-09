# Run the portal on your own computer

This puts a full working copy of the WatchDog Support portal on your computer, with demo customers,
devices and articles, so you can click through it. Nothing is put on the internet.

You need a computer with at least 8 GB of memory (16 GB is better) and about 15 GB of free disk space.

## 1. Install two programs (once)

1. **Docker Desktop** from docker.com/products/docker-desktop. Open it and wait until it shows
   **Engine running**. On Windows, accept if it asks to install WSL, then restart the computer.
2. **Git** from git-scm.com. Keep the default choices during installation.

## 2. Download and start the portal

Open **PowerShell** (Windows) or **Terminal** (Mac) and paste these lines one at a time, pressing Enter
after each:

```
git clone https://github.com/alex-codesmdr/watchdog-support.git
cd watchdog-support
```

Then, on **Windows**:

```
copy .env.example .env
docker compose up -d --build
```

or on a **Mac**:

```
cp .env.example .env
docker compose up -d --build
```

The first start takes 10 to 20 minutes while it downloads and builds everything. Later starts take
about a minute.

## 3. Open it

When the command finishes, open **http://localhost:3000** in your browser.

To sign in, use any demo account from the table in the README, for example:

| Try it as              | Email                            |
| ---------------------- | -------------------------------- |
| Customer administrator | `it.admin@kaveribank.example`    |
| Support engineer       | `vikram.l2@watchdog.example`     |
| Support manager        | `rohan.manager@watchdog.example` |

The password for every demo account is `Demo@WatchDog2026`. The sign-in page then asks for a 6-digit
code: add this key to any authenticator app (Google Authenticator, Microsoft Authenticator) by choosing
"enter a setup key": `K5QXIY3IIRXWORDFNVXVI33UOBFWK6JSGAZDM===`.

Every email the portal would send appears at **http://localhost:8025** instead of going out.

## 4. Stop, start again, or start fresh

In the same folder:

| To                              | Run                                                          |
| ------------------------------- | ------------------------------------------------------------ |
| Stop                            | `docker compose stop`                                        |
| Start again                     | `docker compose up -d`                                       |
| Get the latest version          | `git pull` then `docker compose up -d --build`               |
| Wipe everything and start fresh | `docker compose down -v` then `docker compose up -d --build` |

## If something goes wrong

- **"docker is not recognized" or "Cannot connect to the Docker daemon"**: open Docker Desktop and
  wait for "Engine running".
- **The page does not load**: wait two more minutes; the virus scanner takes a while on first start.
  Then run `docker compose ps` and send a screenshot to your developer.
- **Port already in use**: another program uses port 3000, 4000, 8025 or 8080. Close it, or restart
  the computer.
