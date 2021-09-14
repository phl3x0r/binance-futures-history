import hmac from "crypto-js/hmac-sha256.js";
import { Observable, of, throwError, timer } from "rxjs";
import { catchError, filter, mergeMap, switchMap, tap } from "rxjs/operators";
import fetch, { RequestInit, Request, Response } from "node-fetch";
import AbortController from "abort-controller";
import * as csv from "csv-writer";
import { config } from "./config.js";
import {
  csvHeaders,
  csvHeadersExcel,
  ExcelLine,
  Income,
  IncomeResult,
  IncomeType,
  MappedIncome,
  RecurseParams,
  ReqParams,
} from "./models.js";

// endpoints
const ENDPOINT = "https://fapi.binance.com";

const args = process.argv.slice(2);
const getParam = (p: string) =>
  args[args.findIndex((a) => a.indexOf(p) > -1) + 1];

const fromDate = new Date(getParam("from")).getTime();
const toDate = new Date(getParam("to")).getTime();

if (args.length !== 4) {
  console.log("use: --from <date from> --to <date to>");
  process.exit(9);
}

// const apiKey = config.apiKey;
// const apiSecret = config.apiSecret;

// util functions
const getTime = () => new Date().getTime();
const getQuerystring = (from: number, to: number) =>
  `timestamp=${getTime()}&limit=1000&startTime=${from}&endTime=${to}`;
const getSignature = (querystring, secret: string) =>
  hmac(querystring, secret).toString();
const getUrl = (querystring: string, secret: string) =>
  `${ENDPOINT}/fapi/v1/income?${querystring}&signature=${getSignature(
    querystring,
    secret
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
const historyRequest$ = ({ account, from, to, count = 0 }: ReqParams) =>
  fromFetch(getUrl(getQuerystring(from, to), account.apiSecret), {
    method: "GET",
    headers: getHeaders(account.apiKey),
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
          `${account.name} (#${count}): ${new Date(res[0].time)} to: ${new Date(
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

const recurse = ({
  accounts,
  from,
  to,
  acc,
  last,
  count,
  aggregatedResult,
}: RecurseParams): Observable<{ [key: string]: IncomeResult }> => {
  return historyRequest$({ account: accounts[0], from, to, count }).pipe(
    filter((result) => result instanceof Array),
    mergeMap((result: IncomeResult) => {
      if (result.length === 1000 && !!result[result.length - 1]) {
        return timer(500).pipe(
          switchMap(() =>
            recurse({
              accounts,
              from: result[result.length - 1].time,
              to,
              acc: [...acc, ...removeDupes(result, last)],
              last: result,
              count: count + 1,
              aggregatedResult,
            })
          )
        );
      }
      if (result.length === 0) {
        console.log(`retrying from: ${new Date(from - 100).toISOString()}`);
        return timer(2000).pipe(
          switchMap(() =>
            recurse({
              accounts,
              from: from - 100,
              to,
              acc,
              last,
              count: count + 1,
              aggregatedResult,
            })
          )
        );
      }
      return of([...acc, ...removeDupes(result, last)]).pipe(
        switchMap((res) => {
          const account = accounts.shift();
          if (accounts.length > 0) {
            return recurse({
              accounts,
              from: fromDate,
              to,
              acc: [],
              last: [],
              count: 0,
              aggregatedResult: { ...aggregatedResult, [account.name]: res },
            });
          } else {
            return of({ ...aggregatedResult, [account.name]: res });
          }
        })
      );
    })
  );
};

const consolidate = (entries: Income[]) =>
  Object.values(
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

recurse({
  accounts: config.accounts,
  from: fromDate,
  to: toDate,
  acc: [],
  last: [],
  count: 0,
  aggregatedResult: {},
}).subscribe((res) => {
  Object.entries(res).forEach(([key, entry]) => {
    const [fds, tds] = [fromDate, toDate].map((s) =>
      getDateString(new Date(s))
    );

    const path = `${key}_${fds}_${tds}`;
    const rawPath = createPath(path, "raw");
    cssWriterFactory(rawPath, csvHeaders)
      .writeRecords(entry)
      .then(() => console.log(`Wrote ${rawPath}: ${entry.length} rows`));

    const consolidated = consolidate(entry);
    const consPath = createPath(path, "cons");
    cssWriterFactory(consPath, csvHeaders)
      .writeRecords(consolidated)
      .then(() =>
        console.log(`Wrote ${consPath}: ${consolidated.length} rows`)
      );

    const excel = mapToExcel(consolidated);
    const excPath = createPath(path, "excel");
    cssWriterFactory(excPath, csvHeadersExcel)
      .writeRecords(excel)
      .then(() => console.log(`Wrote ${excPath}: ${excel.length} rows`));
  });
});

function getDateString(td: Date) {
  return `${td.getFullYear()}${td.getMonth().toString().padStart(2, "0")}${td
    .getDate()
    .toString()
    .padStart(2, "0")}`;
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
function cssWriterFactory(
  path: string,
  header: { id: string; title: string }[]
) {
  return csv.createObjectCsvWriter({
    path,
    header,
  });
}

function createPath(path, suffix) {
  return `${path}_${suffix}.csv`;
}
