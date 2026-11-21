# FOD Guard 2.0: Loose Object Control Center

A dashboard for running a loose-object (FOD) program in vehicle general assembly and end-of-line test. It shows where loose objects come from, why they happen, what each countermeasure was worth, and where the next problem is likely to show up.

FOD Guard 1.0 (the Streamlit app in the root of this repo) was a tool for searching past cases, escape analytics and incident reports. Version 2.0 is a full control center with three trained models, an AI assistant and a guided story mode for reviews.

> All data in this repo is synthetic. It is calibrated to a real program that took loose objects at the vehicle drive test (VDT) from about 20 per 100 vehicles down to about 1, but no plant records are included.

## What it does

| View | What you get |
|---|---|
| **Overview** | The line drawn as stations with a live rate per 100 vehicles, KPIs, a daily trend with phases, countermeasure launch pins and control limits, Paretos, a shift brief and AI anomaly alerts. |
| **AI triage** | Type or speak a find in plain words. The model names the likely source area, root cause, object, severity class and time to clear, explains which words drove the call, recommends an action and pulls the most similar past finds. |
| **Risk outlook** | A 7-day forecast for every area and shift. Change new-associate counts or downtime, or let a countermeasure slip, and watch the forecast move. Includes a hiring-wave scenario. |
| **Root cause** | A fishbone with live counts against baseline, finds by hour of the shift, and a detection matrix showing how many VDT runs each find took. |
| **Countermeasures** | A waterfall showing what each fix removed, estimated by the risk model, plus the full register with control level, owner and status. |
| **Cost and ROI** | EOL labor before and after, and a payback check for any capital option. |
| **Ask FOD Guard** | A Claude-powered analyst that calls the dashboard's own data and models as tools. It writes shift briefs, 8D summaries and supplier emails. A built-in offline analyst answers the common questions when Claude isn't available. |
| **Data and models** | Every record, CSV export, CSV import (the triage model fills in missing fields) and model cards with held-out results. |

**Present the story** walks a reviewer through the program in eight steps: the problem, where, why, what changed, the result, what it was worth, how AI keeps it there, and AI at the line. The timeline slider in the top bar replays the whole program week by week.

## The models

All three are trained in Python with scikit-learn and exported to JSON. The browser runs them directly, so there is no server and nothing leaves the page.

1. **Triage (text classification).** TF-IDF on words and word pairs feeding multinomial logistic regression, with three heads. Tested on 2,125 records it never saw:
   - Source area: 89% top-1, 97% top-3
   - Root cause: 90% top-1, 99% top-3
   - Object category: 98% top-1

   The JavaScript re-implementation matches Python to within 0.0001.

2. **Risk (Poisson regression).** Predicts loose objects per 100 vehicles for each area and shift, with vehicles as exposure. Inputs are area, night shift, share of new associates, downtime, and how far each of 7 countermeasure levers has ramped. Deviance explained is 0.84 on a random 20% hold-out. On the last four weeks it is off by 0.22 per 100 a day on an actual rate of 1.09.

3. **Anomaly alerts and impact.** An area and shift is flagged when its count is very unlikely under the risk model (Poisson tail under 0.1%, at least 4 finds). The countermeasure waterfall runs the same model one lever at a time.

Similar-find search uses BM25 over past descriptions.

## Quick start

```bash
cd v2
pip install -r requirements.txt

# 1. Generate the synthetic plant data (26 weeks, about 10,600 finds)
python data/generate_data.py

# 2. Train the models and export them for the app
python models/train.py

# 3. Serve the app
cd app && python -m http.server 8000
# open http://localhost:8000
```

Steps 1 and 2 are optional. The repo ships with the exported `app/data/plant.json` and `app/data/models.json`, so step 3 works on its own.

## Using your own plant data

Two ways:

- **In the app:** Data and models → Bring your own data. Load a CSV with at least a date and a description. The triage model fills in any missing area, root cause or object. The file stays in the browser.
- **Retrain:** replace `data/incidents.csv` and `data/shifts.csv` with your records in the same columns, then run `python models/train.py`.

## Project layout

```
data/generate_data.py   synthetic plant simulation (shifts, areas, causes, countermeasure ramps)
models/train.py         trains triage, risk and impact models, exports JSON
reports/                model card and metrics
app/index.html          the dashboard
app/styles.css
app/js/core.js          data loading and aggregation
app/js/ai.js            triage, BM25 search, risk forecast, anomaly alerts
app/js/charts.js        ECharts views with table fallbacks
app/js/views.js         each screen
app/js/assistant.js     Claude analyst with tool calls, plus offline answers
app/js/main.js          routing, timeline, story mode, import and export
```

## Notes

- Light and dark themes, keyboard navigation, a table view behind every chart, and a layout that works on a phone.
- Claude, voice input and the shared find log need the hosted version. Run locally, the app falls back to the offline analyst and a session-only log.
- Charts use ECharts 5.4.3 from cdnjs.

## Author

Dr. Fitsum Taye Feyissa
