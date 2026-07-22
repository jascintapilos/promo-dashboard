# Pushing Your Dashboard to Bitbucket

Hey! This guide gets your dashboard code onto Aiodin's Bitbucket so our team can pick it
up. **Each dashboard has its own repo** (a "repo" is just an online folder for code).
Once your code is pushed, you're done — we handle publishing from there.

> 💡 Got Claude? Paste this whole guide into Claude Code or the Claude app and say
> *"walk me through this and run the commands for me."* It can do most of it for you.

The setup (Steps 1–6) is a **one-time thing**. After that, pushing updates is just a
few commands that take under a minute.

---

## 1. Get into Bitbucket

You'll get an email invite to the `aiodintech` workspace. Click the link, create a
Bitbucket login if you don't have one (use the **same email** the invite went to), then
sign in at **https://bitbucket.org** and check you can see `aiodintech`.

---

## 2. Install Git

Git is the tool that sends your code to Bitbucket.

**Mac:** Open the **Terminal** app (`Cmd+Space`, type "Terminal", Enter) and run:
```bash
git --version
```
If you see a version number, you're set. If it offers to install developer tools, click
**Install** and wait.

**Windows:** Download Git from **https://gitforwindows.org** and run the installer —
just click **Next** through everything. Then open **Git Bash** (search the Start menu).
👉 On Windows, run *every* command in this guide inside **Git Bash**, not the regular
Command Prompt — that way the commands match exactly.

---

## 3. Tell Git who you are

Run these two lines (your real name + the email your invite went to):
```bash
git config --global user.name "Your Name"
git config --global user.email "you@example.com"
```

---

## 4. Make your SSH key

An SSH key is like a digital ID badge so you don't type a password every time. You make
it once. Run (same email as above):
```bash
ssh-keygen -t ed25519 -C "you@example.com"
```
- When it asks where to save the key → just press **Enter**.
- When it asks for a passphrase → press **Enter** twice to skip it (or set one if you like).

This creates two files: `id_ed25519` (your **private** key — never share it) and
`id_ed25519.pub` (your **public** key — safe to share, you'll paste it next).

---

## 5. Add your public key to Bitbucket

Copy your public key to the clipboard:

**Mac:**
```bash
pbcopy < ~/.ssh/id_ed25519.pub
```
**Windows (Git Bash):**
```bash
clip < ~/.ssh/id_ed25519.pub
```

Then on **https://bitbucket.org**: click your avatar (bottom-left) → **Personal settings**
→ **SSH keys** → **Add key**. Give it a label like "My laptop", paste the key (it starts
with `ssh-ed25519`), and click **Add key**.

> If copy didn't work, open `~/.ssh/id_ed25519.pub` in any text editor and copy the whole
> line by hand. The `.pub` file is the safe one — never share the one without `.pub`.

---

## 6. Test the connection

```bash
ssh -T git@bitbucket.org
```
First time it asks *"Are you sure you want to continue connecting?"* → type **yes**.
If you see your username and *"You can use git..."*, it worked. 🎉
If it says *"Permission denied"*, redo Step 5.

---

## 7. Open your dashboard folder in the terminal

You already have your dashboard's source code in a folder on your computer — we're going
to push that whole folder up as-is. First, point the terminal at it.

**Mac (Terminal):** type `cd ` (with a space after it), then drag the folder onto the
Terminal window and press Enter. Or type the path yourself, e.g.:
```bash
cd ~/Desktop/my-dashboard
```
**Windows (Git Bash):** same idea — type `cd `, drag the folder in, press Enter.

To check you're in the right place, run `ls` — you should see your dashboard files listed.

---

## 8. Connect your folder to Bitbucket

Tommy will give you your repo's **SSH link** — it looks like
`git@bitbucket.org:aiodintech/your-dashboard.git`. Run these one at a time (paste your own
link in the third line):
```bash
git init
git branch -M main
git remote add origin git@bitbucket.org:aiodintech/your-dashboard.git
```
- `git init` turns your folder into something Git can track
- `git branch -M main` names your main branch
- `git remote add origin ...` points it at your Bitbucket repo

> Done `git init` here before? You'll see *"Reinitialized existing Git repository"* — that's
> fine. If `remote add` says *"remote origin already exists"*, run
> `git remote set-url origin <your link>` instead.

---

## 9. Commit and push all your code

Run these one at a time:
```bash
git add .
git commit -m "Initial commit of dashboard"
git push -u origin main
```
- `git add .` grabs **all** the files in your folder
- `git commit -m "..."` saves a snapshot with a short note
- `git push -u origin main` uploads everything to Bitbucket

> 🔒 Before you push, glance over your files — make sure you're not sending up passwords,
> API keys, or other secrets. If a file has sensitive info, check with Tommy first.

---

## 10. Check it worked

Open your repo on **https://bitbucket.org** and refresh — all your source code should be
there. **That's it, you're done!** We take it from here.

---

## Updating later (the quick version)

Once you're set up, future updates are easy. Open Terminal / Git Bash and:
```bash
cd path/to/your-dashboard-folder
git pull          # grab the latest first
# ...make your changes / drop in updated files...
git add .
git commit -m "Describe what you changed"
git push
```

---

## If something breaks

| Problem | Fix |
|---|---|
| `git: command not found` | Git isn't installed — redo **Step 2**. (Windows: use **Git Bash**.) |
| `Permission denied (publickey)` | SSH key issue — redo **Step 5**, then test with **Step 6**. |
| `Repository not found` / access denied | You don't have access yet, or the link's wrong — ping Tommy. |
| First push rejected / "fetch first" | The repo already has a file (e.g. a README). Run `git pull origin main --allow-unrelated-histories`, then `git push` again. |
| `Updates were rejected` on push | Someone pushed first. Run `git pull`, then `git push` again. |
| Anything else | Copy the full error and send it to Tommy, or paste it into Claude and ask. |

---

## Quick glossary

- **Repo** — the online folder on Bitbucket for one dashboard
- **Git** — the tool that sends code to the repo
- **Clone** — download a copy of the repo to your computer
- **Commit** — save a labelled snapshot of your changes
- **Push** — upload your changes to Bitbucket
- **Pull** — download the latest changes
- **SSH key** — your computer's ID badge; the `.pub` file is safe to share, the other one isn't
