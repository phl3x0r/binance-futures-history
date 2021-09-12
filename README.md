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

rename `src/config-example.ts` -> `src/config.ts` and update `apiKey` and `apiSecret` values

## build
```sh
npm run build
```

## run
```sh
npm start -- --o <output filename> --from <from date> --to <to date>
```
Where from date and to date must be date parseable by js Date constructor, e.g MM.DD.YYYY

### example
```sh
npm start -- --o my_history --from 6.1.2021 --to 9.1.2021
```
