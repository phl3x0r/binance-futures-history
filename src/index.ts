import hmac from "crypto-js/hmac-sha256.js";
import { Observable, of, throwError, timer } from "rxjs";
import { catchError, filter, mergeMap, switchMap, tap } from "rxjs/operators";
import fetch, { RequestInit, Request, Response } from "node-fetch";
import AbortController from "abort-controller";
import * as csv from "csv-writer";
import { config } from "./config.js";

// endpoints
const ENDPOINT = "https://fapi.binance.com";

const args = process.argv.slice(2);
const getParam = (p: string) =>
  args[args.findIndex((a) => a.indexOf(p) > -1) + 1];

const filename = getParam("o");
const fromDate = new Date(getParam("from")).getTime();
const toDate = new Date(getParam("to")).getTime();

if (args.length !== 6 || !filename) {
  console.log("use: --o <output filename> --from <date from> --to <date to>");
  process.exit(9);
}

const apiKey = config.apiKey;
const apiSecret = config.apiSecret;

// util functions
const getTime = () => new Date().getTime();
const getQuerystring = (from: number, to: number) =>
  `timestamp=${getTime()}&limit=1000&startTime=${from}&endTime=${to}`;
const getSignature = (querystring, secret: string) =>
  hmac(querystring, secret).toString();
const getUrl = (querystring: string) =>
  `${ENDPOINT}/fapi/v1/income?${querystring}&signature=${getSignature(
    querystring,
    apiSecret
  )}`;
const getHeaders = (apiKey: string) => ({ "X-MBX-APIKEY": apiKey });

const removeDupes = (cur: IncomeResult, acc: IncomeResult) =>
  cur.filter(
    (thing, index) =>
      acc.findIndex(
        (t) =>
          t.symbol === thing.symbol &&
          t.incomeType === thing.incomeType &&
          t.income === thing.income &&
          t.asset === thing.asset &&
          t.info === thing.info &&
          t.time === thing.time &&
          t.tranId === thing.tranId &&
          t.tradeId === thing.tradeId
      ) === -1
  );

// the history request
const historyRequest$ = (from: number, to: number, count: number = 0) =>
  fromFetch(getUrl(getQuerystring(from, to)), {
    method: "GET",
    headers: getHeaders(apiKey),
  }).pipe(
    switchMap((response) => {
      if (response.ok) {
        // OK return data
        return response.json() as Promise<IncomeResult>;
      } else {
        // Server is returning a status requiring the client to try something else.
        return throwError(() => new Error(`Error ${response.status}`));
      }
    }),
    tap((res) => {
      if (res && res.length) {
        console.log(
          `#${count}: ${new Date(res[0].time)} to: ${new Date(
            res[res.length - 1].time
          )}`
        );
      }
    }),
    catchError((err) => {
      // Network or other error, handle appropriately
      console.error(err);
      return of({ error: true, message: err.message });
    })
  );

const recurse = (
  from: number,
  to: number,
  acc: IncomeResult,
  last: IncomeResult,
  count: number
): Observable<IncomeResult> =>
  historyRequest$(from, to, count).pipe(
    filter((result) => result instanceof Array),
    mergeMap((result: IncomeResult) => {
      if (result.length === 1000 && !!result[result.length - 1]) {
        return timer(500).pipe(
          switchMap(() =>
            recurse(
              result[result.length - 1].time,
              to,
              [...acc, ...removeDupes(result, last)],
              result,
              count + 1
            )
          )
        );
      }
      if (result.length === 0) {
        console.log(`retrying from: ${new Date(from - 100).toISOString()}`);
        return timer(2000).pipe(
          switchMap(() => recurse(from - 100, to, acc, last, count + 1))
        );
      }
      return of([...acc, ...removeDupes(result, last)]);
    })
  );

const csvWriter = csv.createObjectCsvWriter({
  path: `${filename}_raw.csv`,
  header: [
    { id: "symbol", title: "symbol" },
    { id: "incomeType", title: "incomeType" },
    { id: "income", title: "income" },
    { id: "asset", title: "asset" },
    { id: "info", title: "info" },
    { id: "time", title: "time" },
    { id: "tranId", title: "tranId" },
    { id: "tradeId", title: "tradeId" },
  ],
});

const csvWriterCons = csv.createObjectCsvWriter({
  path: `${filename}_daily.csv`,
  header: [
    { id: "symbol", title: "symbol" },
    { id: "incomeType", title: "incomeType" },
    { id: "income", title: "income" },
    { id: "asset", title: "asset" },
    { id: "info", title: "info" },
    { id: "time", title: "time" },
    { id: "tranId", title: "tranId" },
    { id: "tradeId", title: "tradeId" },
  ],
});

const csvWriterExcel = csv.createObjectCsvWriter({
  path: `${filename}_excel.csv`,
  header: [
    { id: "date", title: "date" },
    { id: "transfer", title: "transfer" },
    { id: "relizedPnl", title: "relizedPnl" },
    { id: "fundingFee", title: "fundingFee" },
    { id: "commission", title: "commission" },
    { id: "insuranceClear", title: "insuranceClear" },
    { id: "welcomeBonus", title: "welcomeBonus" },
    { id: "total", title: "total" },
    { id: "asset", title: "asset" },
  ],
});

const consolidate = (entries: Income[]) =>
  Object.entries(
    entries
      .sort((a, b) => a.time - b.time)
      .reduce((acc: { [key: string]: MappedIncome[] }, cur: Income) => {
        const accStr = `${cur.asset}::${cur.incomeType}`;
        if (!acc[accStr]) {
          acc[accStr] = [];
        }
        const currenList = acc[accStr];
        if (
          !currenList ||
          !currenList.length ||
          new Date(currenList[currenList.length - 1]?.time)?.getDate() !==
            new Date(cur.time).getDate()
        ) {
          currenList.push({
            ...cur,
            income: Number.parseFloat(cur.income),
            symbol: "",
          });
        } else {
          const last = currenList[currenList.length - 1];
          last.income += Number.parseFloat(cur.income);
          last.time = cur.time;
        }
        return acc;
      }, {})
  )
    .map(([_key, entries]) => entries)
    .reduce((a, b) => a.concat(b), [])
    .sort((a, b) => a.time - b.time);

const mapToExcel = (entries: MappedIncome[]) =>
  Object.entries(
    entries
      .sort((a, b) => a.time - b.time)
      .reduce((acc: { [key: string]: ExcelLine[] }, cur: MappedIncome) => {
        const accStr = `${cur.asset}`;
        if (!acc[accStr]) {
          acc[accStr] = [];
        }
        const currenList = acc[accStr];
        if (
          !currenList ||
          !currenList.length ||
          currenList[currenList.length - 1]?.date !==
            new Date(cur.time).toLocaleDateString()
        ) {
          currenList.push({
            date: new Date(cur.time).toLocaleDateString(),
            asset: cur.asset,
            transfer: cur.incomeType === IncomeType.TRANSFER ? cur.income : 0,
            relizedPnl:
              cur.incomeType === IncomeType.REALIZED_PNL ? cur.income : 0,
            fundingFee:
              cur.incomeType === IncomeType.FUNDING_FEE ? cur.income : 0,
            commission:
              cur.incomeType === IncomeType.COMMISSION ? cur.income : 0,
            insuranceClear:
              cur.incomeType === IncomeType.INSURANCE_CLEAR ? cur.income : 0,
            welcomeBonus:
              cur.incomeType === IncomeType.WELCOME_BONUS ? cur.income : 0,
            total: cur.income,
          });
        } else {
          const last = currenList[currenList.length - 1];
          last.date = new Date(cur.time).toLocaleDateString();
          last.transfer +=
            cur.incomeType === IncomeType.TRANSFER ? cur.income : 0;
          last.relizedPnl +=
            cur.incomeType === IncomeType.REALIZED_PNL ? cur.income : 0;
          last.fundingFee +=
            cur.incomeType === IncomeType.FUNDING_FEE ? cur.income : 0;
          last.commission +=
            cur.incomeType === IncomeType.COMMISSION ? cur.income : 0;
          last.insuranceClear +=
            cur.incomeType === IncomeType.INSURANCE_CLEAR ? cur.income : 0;
          last.welcomeBonus +=
            cur.incomeType === IncomeType.WELCOME_BONUS ? cur.income : 0;
          last.total += cur.income;
        }
        return acc;
      }, {})
  )
    .map(([_key, entries]) => entries)
    .reduce((a, b) => a.concat(b), [])
    .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());

recurse(fromDate, toDate, [], [], 0).subscribe((res) => {
  console.log("final: ");
  console.log(`first: ${new Date(res[0].time)}`);
  console.log(`last: ${new Date(res[res.length - 1].time)}`);
  csvWriter
    .writeRecords(res)
    .then(() => console.log(`Wrote Raw: ${res.length} rows`));
  const consolidated = consolidate(res);
  csvWriterCons
    .writeRecords(consolidated)
    .then(() => console.log(`Wrote Consolidated: ${consolidated.length} rows`));
  const excel = mapToExcel(consolidated);
  csvWriterExcel
    .writeRecords(excel)
    .then(() => console.log(`Wrote Excel: ${excel.length} rows`));
});

interface Income {
  symbol: string;
  incomeType: string;
  income: string;
  asset: string;
  info: string;
  time: number;
  tranId: string;
  tradeId: string;
}

interface MappedIncome {
  symbol: string;
  incomeType: string;
  income: number;
  asset: string;
  info: string;
  time: number;
  tranId: string;
  tradeId: string;
}

enum IncomeType {
  TRANSFER = "TRANSFER",
  WELCOME_BONUS = "WELCOME_BONUS",
  REALIZED_PNL = "REALIZED_PNL",
  FUNDING_FEE = "FUNDING_FEE",
  COMMISSION = "COMMISSION",
  INSURANCE_CLEAR = "INSURANCE_CLEAR",
}

interface ExcelLine {
  date: string;
  transfer: number;
  relizedPnl: number;
  fundingFee: number;
  commission: number;
  insuranceClear: number;
  welcomeBonus: number;
  total: number;
  asset: string;
}

type IncomeResult = Array<Income>;

interface Config {
  apiKey: string;
  apiSecret: string;
}

function fromFetch(
  input: string | Request,
  init?: RequestInit
): Observable<Response> {
  return new Observable<Response>((subscriber) => {
    const controller = new AbortController();
    const signal = controller.signal;
    let outerSignalHandler: () => void;
    let abortable = true;
    let unsubscribed = false;

    if (init) {
      // If a signal is provided, just have it teardown. It's a cancellation token, basically.
      if (init.signal) {
        outerSignalHandler = () => {
          if (!signal.aborted) {
            controller.abort();
          }
        };
        init.signal.addEventListener("abort", outerSignalHandler);
      }
      init.signal = signal;
    } else {
      init = { signal };
    }

    fetch(input, init)
      .then((response) => {
        abortable = false;
        subscriber.next(response);
        subscriber.complete();
      })
      .catch((err) => {
        abortable = false;
        if (!unsubscribed) {
          // Only forward the error if it wasn't an abort.
          subscriber.error(err);
        }
      });

    return () => {
      unsubscribed = true;
      if (abortable) {
        controller.abort();
      }
    };
  });
}
