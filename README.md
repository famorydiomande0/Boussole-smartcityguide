# Boussole backend — setup steps

This backend does two separate jobs:

1. **Free map searches** (geocoding + nearby places via OpenStreetMap) — proxied and cached so
   visitors without a Google key don't hit OpenStreetMap's shared free rate limit directly.
2. **Google-powered search, for everyone, without visitors needing their own key** — your own
   Google API key lives only on the server (never sent to the browser), and results are cached
   so cost scales with how many distinct cities get searched, not with every single visitor.

**Cost reality, please read before deploying job #2:** unlike job #1 (genuinely free at any
realistic scale), Google Places billing is real money once you're past its free monthly
allowance, and your app's field selection (ratings + hours) puts it in Google's more expensive
pricing tier — full numbers were walked through in chat, but the short version: **set a budget
cap in Google Cloud before this goes live to real customers** (see Step 4 below). The caching
here controls the *multiplication* (visitors × searches), it doesn't make Google itself free.

## What's in this folder

```
netlify.toml                       <- tells Netlify where the functions live
netlify/functions/geocode.js       <- free: place name -> coordinates (OpenStreetMap)
netlify/functions/reverse.js       <- free: coordinates -> place name (OpenStreetMap)
netlify/functions/places.js        <- free: nearby places (OpenStreetMap) — the original rate-limit fix
netlify/functions/google-search.js <- Google-powered nearby places, cached, using YOUR key server-side
```

Your `boussole.html` file goes in the same top-level folder as `netlify.toml` (not inside
the `netlify` folder) — so the finished structure looks like:

```
your-project/
├── boussole.html
├── netlify.toml
└── netlify/
    └── functions/
        ├── geocode.js
        ├── reverse.js
        ├── places.js
        └── google-search.js
```

## Step 1 — Deploy the files (three ways, ranked by reliability)

### Recommended: GitHub (most reliable, and best for ongoing updates)

This is genuinely the cleanest option — Netlify's Functions support is built primarily around
Git-connected deploys, so this sidesteps any ambiguity about whether Functions get picked up,
and every future change just needs a `git push` instead of re-deploying by hand each time.

1. If you don't already have one, create a free account at https://github.com.
2. Click the **+** in the top right → **New repository**. Give it any name (e.g. `boussole`),
   keep it either public or private (either works fine for this), and click **Create repository**.
3. On the new repo's page, click **uploading an existing file** (or **Add file → Upload files**),
   then drag in all the files/folders from this package (`boussole.html`, `netlify.toml`, and
   the whole `netlify` folder with `functions` inside it), keeping the same structure shown
   above. Commit the upload.
4. In your **Netlify** dashboard, open your existing Boussole site → **Site configuration →
   Build & deploy → Continuous deployment**, and look for an option to **link a repository**
   (wording varies slightly by Netlify's current UI, sometimes under "Link site to Git").
5. Choose GitHub, authorize Netlify to access your account if asked, and select the repo you
   just created. Leave build settings as their defaults (no build command needed — this is
   plain static files plus functions) and confirm.
6. Netlify will deploy automatically. Check the **Functions** tab in your site dashboard — you
   should see `geocode`, `reverse`, `places`, and `google-search` listed.
7. From now on, whenever you want to update anything (new places added, code changes), just
   upload the changed files to this same GitHub repo and Netlify redeploys automatically —
   no more manual drag-and-drop needed for any future update either.

### Alternative: try drag-and-drop first (costs nothing to test, less reliable)

Netlify's plain drag-and-drop deploy has gotten better at detecting projects that need more
than static files, but it's genuinely inconsistent — worth a quick try, not worth relying on.

1. Put all the files above into one folder on your computer, matching the structure shown.
2. Make sure you're **logged in** to Netlify first (this matters — logged-out drops just
   publish files as-is, with no processing).
3. Go to your site in the Netlify dashboard → drag that whole folder onto the deploy area.
4. Check the **Functions** tab afterward — if `geocode`, `reverse`, `places`, and
   `google-search` are all listed, it worked. If the tab is empty, use GitHub or the CLI instead.

### Alternative: Netlify CLI (guaranteed, but manual each time)

1. Install Node.js if you don't have it already: https://nodejs.org
2. In a terminal: `npm install -g netlify-cli`
3. In your project folder: `netlify login`, then `netlify link` (pick your existing Boussole
   site when asked).
4. Deploy: `netlify deploy --prod`
5. Check the Functions tab to confirm all four are listed.

## Step 2 — Confirm your Google API key is set as an environment variable

**Good news: this is likely already done.** Earlier in our chat, I connected directly to your
Netlify account and set `GOOGLE_MAPS_API_KEY` on your Boussole site as a secret environment
variable — you don't need to add it again. To double-check it's really there:

1. In your Netlify dashboard, go to **Site configuration → Environment variables**.
2. Look for `GOOGLE_MAPS_API_KEY` in the list.

If it's there, skip to Step 3. If it's somehow missing, add it yourself: click **Add a
variable**, name it exactly `GOOGLE_MAPS_API_KEY`, and paste your key as the value.
**Never put your real API key inside `google-search.js` or any file you deploy** — this
environment variable is the only place it should live.

## Step 3 — Set a Google Cloud budget cap (do this before real customers use it)

Google does **not** stop charging you automatically once you hit a budget — alerts notify you,
they don't block spending. To actually cap what you can be charged:

1. In Google Cloud Console, go to **Billing → Budgets & alerts**.
2. Create a budget at whatever ceiling you're comfortable risking.
3. For a hard stop (not just a notification), look into Google Cloud's budget-triggered Cloud
   Function pattern that automatically disables billing on the project once the cap is hit —
   this is more setup than a plain alert, but it's the only way to guarantee you can't be
   billed past your ceiling. Google's own documentation covers this under "Disable billing
   automatically" in the Budgets & alerts section.

## Step 4 — Turn it all on in the app

Once you've confirmed the functions are deployed (Functions tab) and the environment variable
is set (Step 2), open `boussole.html`, find this line near the top of the `<script>` section:

```js
const BACKEND_BASE_URL = '';
```

and change it to:

```js
const BACKEND_BASE_URL = '/.netlify/functions';
```

Redeploy that updated HTML file the same way you deploy everything else (via your GitHub repo,
if you set that up in Step 1). From that point on:
- Every visitor gets Google-quality search results (ratings, hours, real addresses) with no
  key of their own and no setup on their end.
- The free OSM functions still cover geocoding and the "near me" lookup.
- Google costs are shared and cached across all visitors instead of multiplying per person.

## If something goes wrong

- **Live search stops working after Step 4**: double-check the Functions tab actually shows
  all four functions deployed, and that `GOOGLE_MAPS_API_KEY` is set, before flipping that
  line — if either isn't ready yet, live search will fail. You can always set
  `BACKEND_BASE_URL` back to `''` to instantly revert to the old (working) behavior while you
  sort out the deploy.
- **"Function not found" or 404s**: usually means the folder structure wasn't exactly as shown
  above when you deployed — `netlify.toml` needs to sit next to `boussole.html`, not inside
  the `netlify` folder.
- **google-search returns an error about GOOGLE_MAPS_API_KEY**: the environment variable isn't
  set yet, or you deployed before adding it — redeploy after Step 3.

