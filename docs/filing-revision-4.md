# Filing deployment record revision 4 (Hunter, about 15 minutes)

Only after Mako has confirmed the three maintenance decisions and Claude has filled in his
confirmation and both sign-off dates (Claude says when). Done in the browser, so the commit
is in Hunter's name and signed by GitHub; no AI co-author line.

1. On the Mac, get the final file and give it the upstream name:
   ```
   cd ~/Desktop/veilcore
   git pull
   cp docs/deployment-record-revision-4.md ~/Desktop/veilcore.md
   ```
2. Open github.com/midnightntwrk/midnight-improvement-proposals and click **Fork** (or, if
   you already have a fork, open it and click **Sync fork**, then **Update branch**).
3. In your fork, open the `deployments` folder. Click **Add file**, then **Upload files**.
   Drag `veilcore.md` from your Desktop in. It replaces the existing `veilcore.md` (same
   name, same folder).
4. Under **Commit changes**:
   - Message: `deployments/veilcore.md: revision 4, filed before the mainnet deploy`
   - Choose **Create a new branch for this commit and start a pull request**. Name it
     `veilcore-revision-4`.
   - Click **Propose changes**.
5. On the pull request page, check it targets `midnightntwrk/midnight-improvement-proposals`
   `main`. Title: `VeilCore: deployment record revision 4 (before mainnet)`. Paste the
   description Claude gives you. Click **Create pull request**.
6. Send Claude the pull request link. Claude fills in *Filed upstream* in our copy.

Then the deploy can go ahead: `export VEILCORE_DEPLOYMENT_RECORD_REVISION=4` is true from
here on.
