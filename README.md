# binance-futures-history

tools to get and consolidate history data from binance

## prerequisites

This project uses typescript, install with

```sh
npm install -g typescript
```

Install project dependencies

```sh
npm install
```

rename `src/config-example.ts` -> `src/config.ts` and insert account objects for each account

## build

```sh
npm run build
```

## run

```sh
npm start -- --from <from date> --to <to date>
```

Where from date and to date must be date parseable by js [Date constructor](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Date/Date), e.g MM.DD.YYYY

### example

```sh
npm start -- --from 6.1.2021 --to 9.1.2021
```
