export interface Account {
  name: string;
  apiKey: string;
  apiSecret: string;
}

export interface Config {
  accounts: Account[];
}

export interface ReqParams {
  from: number;
  to: number;
  account: Account;
  count?: number;
}

export interface RecurseParams {
  accounts: Account[];
  from: number;
  to: number;
  acc: IncomeResult;
  last: IncomeResult;
  count: number;
  aggregatedResult: { [key: string]: IncomeResult };
}

export interface Income {
  symbol: string;
  incomeType: string;
  income: string;
  asset: string;
  info: string;
  time: number;
  tranId: string;
  tradeId: string;
}

export interface MappedIncome {
  symbol: string;
  incomeType: string;
  income: number;
  asset: string;
  info: string;
  time: number;
  tranId: string;
  tradeId: string;
}

export enum IncomeType {
  TRANSFER = "TRANSFER",
  WELCOME_BONUS = "WELCOME_BONUS",
  REALIZED_PNL = "REALIZED_PNL",
  FUNDING_FEE = "FUNDING_FEE",
  COMMISSION = "COMMISSION",
  INSURANCE_CLEAR = "INSURANCE_CLEAR",
  COMMISSION_REBATE = "COMMISSION_REBATE",
  REFERRAL_KICKBACK = "REFERRAL_KICKBACK",
}

export interface ExcelLine {
  date: string;
  transfer: number;
  realizedPnl: number;
  fundingFee: number;
  commission: number;
  commissionRebate: number;
  referralKickback: number;
  insuranceClear: number;
  welcomeBonus: number;
  total: number;
  asset: string;
}

export type IncomeResult = Array<Income>;

export const csvHeaders = [
  { id: "symbol", title: "symbol" },
  { id: "incomeType", title: "incomeType" },
  { id: "income", title: "income" },
  { id: "asset", title: "asset" },
  { id: "info", title: "info" },
  { id: "time", title: "time" },
  { id: "tranId", title: "tranId" },
  { id: "tradeId", title: "tradeId" },
];

export const csvHeadersExcel = [
  { id: "date", title: "date" },
  { id: "transfer", title: "transfer" },
  { id: "realizedPnl", title: "realizedPnl" },
  { id: "fundingFee", title: "fundingFee" },
  { id: "commission", title: "commission" },
  { id: "commissionRebate", title: "commissionRebate" },
  { id: "referralKickback", title: "referralKickback" },
  { id: "insuranceClear", title: "insuranceClear" },
  { id: "welcomeBonus", title: "welcomeBonus" },
  { id: "total", title: "total" },
  { id: "asset", title: "asset" },
];
