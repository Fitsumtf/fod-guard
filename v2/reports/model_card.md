# FOD Guard 2 model card

Trained on 10,008 synthetic loose-object records and 2,912 area-shift rows.
No plant data was used. Retrain on your own data before relying on the numbers.

## 1. Triage (text classifier)

TF-IDF (unigrams and bigrams, 1,332 terms, sublinear tf) feeding multinomial
logistic regression. Held-out test set: 2,002 records (20%, stratified).

| Head | Classes | Top-1 accuracy | Top-3 accuracy | Macro F1 |
|---|---|---|---|---|
| Source area | 8 | 89.3% | 97.1% | 0.916 |
| Object category | 7 | 97.9% | 100.0% | 0.981 |
| Root cause | 14 | 89.1% | 99.0% | 0.918 |

About 20% of descriptions carry no area cue on purpose, so the area head can't be
perfect. Show the top three to the technician, not just the first.

## 2. Risk (Poisson regression)

Loose objects per area and shift, with vehicles built as exposure. Inputs: area,
night shift, share of new associates (people-driven areas), downtime hours, and
the ramp of each of 7 countermeasure levers by area. Countermeasures launched on
the same day are grouped into one lever because their effects can't be separated.

- Hold-out: last 4 weeks (2026-10-19 onward)
- Deviance explained (D²) on a random 20% hold-out: 0.829
- Forecast check on the last 4 weeks: daily plant rate mean absolute error
  0.19 per 100 vehicles, against an actual mean of
  1.00. (D² on those 4 weeks alone is 0.20,
  because counts that low are mostly noise.)

## 3. Impact

The risk model run lever by lever in launch order, at baseline staffing and
downtime. Baseline 19.9 per 100 vehicles, all levers on
1.00 per 100 vehicles.

## Limits

- Synthetic data follows the patterns it was built with; real data will be noisier.
- The risk model has no memory of compliance slipping (for example the October
  spike); that is what the anomaly alert is for.
- Text triage only knows words seen in training. New part names need retraining.
