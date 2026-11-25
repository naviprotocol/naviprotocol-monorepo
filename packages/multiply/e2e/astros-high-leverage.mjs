// Compare the first real swap quote with its gross rate/price estimate. Read-only.
import { mkdir,writeFile } from 'node:fs/promises'
import { SuiGrpcClient } from '@mysten/sui/grpc'
import { createMultiplyClient, createNaviDataSource, createChainRateHintReader, astrosConverter, SUI,VSUI,HASUI } from '../dist/index.js'
import { BN } from '../dist/utils.js'
const USDC='0xdba34672e30cb065b1f93e3ab55318768fd6fef66c15942c9f7cb846e2f900e7::usdc::USDC',USD='0x44f838219cf67b058f3b37907b655f226153c18e33dfcd0da559a844fea9b1c1::usdsui::USDSUI'
const defs=[['vsui',VSUI,SUI,0,'6.97'],['hasui',HASUI,SUI,undefined,'2.8'],['usdsui',USD,USDC,2,'4']]
const client=new SuiGrpcClient({network:'mainnet',baseUrl:'https://fullnode.mainnet.sui.io:443'}), owner='0xc41d2d2b2988e00f9b64e7c41a5e70ef58a3ef835703eeb6bf1bd17a9497d9fe'
const out=process.env.MULTIPLY_HIGH_OUT??'/private/tmp/multiply-high-leverage';await mkdir(out,{recursive:true});const report={broadcast:false,markets:{},scope:'First real Astros quote vs contemporaneous chain-rate/price estimate; synthetic principal/position, not a wallet transaction.',rows:[]};let saves=Promise.resolve();const save=()=>{const text=JSON.stringify(report,null,2);saves=saves.then(()=>writeFile(`${out}/results.json`,text));return saves}
const floor=x=>new BN(x).integerValue(BN.ROUND_FLOOR),ceil=x=>new BN(x).integerValue(BN.ROUND_CEIL)
await Promise.all(defs.map(async([id,cType,dType,emodeId,high],index)=>{
const strategy={id:`error-${id}`,market:'main',registryKey:{strategyNumericId:String(100+index),strategyVersion:'1'},...(emodeId===undefined?{}:{emodeId}),principalCoinType:dType,collateralCoinType:cType,debtCoinType:dType}
const live=createNaviDataSource({client,strategies:[strategy]}), market=await live.readMarket(strategy), fee=await live.readBorrowFeeBps(market),pc=new BN(market.collateralPrice).shiftedBy(-market.collateral.token.decimals),pd=new BN(market.debtPrice).shiftedBy(-market.debt.token.decimals)
const ff=new BN(1).plus(new BN(market.flash.feeBps).div(10000)), bf=new BN(fee).div(10000), slip=new BN('.995')
report.markets[id]=market
for(const minHF of [...new Set([id==='hasui'?'1.07':'1.05','1.08'])]) {
 const ratio=BN.minimum(new BN(market.ltv).div(market.borrowWeight),new BN(market.liquidationThreshold).div(new BN(market.borrowWeight).times(minHF)))
 const nominalCap=new BN(1).div(new BN(1).minus(ratio)), slipCap=new BN(1).div(new BN(1).minus(ratio.times(slip))), safe=slipCap.decimalPlaces(2,BN.ROUND_FLOOR)
 const levels=[['below-bound',safe.minus('.01').toFixed(2)],['at-rounded-bound',safe.toFixed(2)],['above-slippage-bound',safe.plus('.01').toFixed(2)],['nominal-rounded-edge',nominalCap.decimalPlaces(2,BN.ROUND_FLOOR).plus('.01').toFixed(2)],['above-protocol-bound',nominalCap.decimalPlaces(2,BN.ROUND_CEIL).plus('.01').toFixed(2)]]
 for(const principal of ['100','100000'])for(const name of ['open','increase'])for(const [level,target]of levels.filter(([level])=>!process.env.MULTIPLY_HIGH_LEVELS||process.env.MULTIPLY_HIGH_LEVELS.split(',').includes(level))){
 const P=new BN(principal).shiftedBy(market.debt.token.decimals),increasing=true,opening=name==='open',C=opening?new BN(0):floor(P.times(pd).times(2).div(pc)),D=opening?new BN(0):P
 const row={strategy:id,principal,principalCoin:dType,action:name,target,level,minHF,nominalCap:nominalCap.toFixed(12),openSlippageCap:slipCap.toFixed(12),market:{collateralPrice:market.collateralPrice,debtPrice:market.debtPrice,lt:market.liquidationThreshold,borrowWeight:market.borrowWeight,borrowFeeBps:fee,flashFeeBps:market.flash.feeBps},calls:[]}
 const reader=createChainRateHintReader(client),converter=astrosConverter({client}),quote=converter.quote.bind(converter)
 converter.quote=async req=>{const q=await quote(req);row.calls.push({request:req,quote:q});return q}
 const source={...live,listAccountCaps:async()=>opening?[]:[{id:'0x'+'b'.repeat(64),accountOwner:'0x'+'c'.repeat(64),strategyId:strategy.id,registryKey:strategy.registryKey}],readMarket:async()=>({...market,observedAt:Date.now()}),readPosition:async()=>({collateralAmount:C.toFixed(0),debtAmount:D.toFixed(0)}),readBorrowFeeBps:async()=>fee}
 const engine=createMultiplyClient({client,dataSource:source,strategies:[strategy],converters:[],fallbackConverter:converter,rateHintProvider:async pair=>{const h=await reader(pair);row.hint=h;return h}})
 try{const q=await engine.quote(owner,strategy,opening?{type:'open',amount:P.toFixed(0),targetLeverage:target}:{type:'set_leverage',targetLeverage:target},{minHealthFactor:minHF,maxSlippageBps:50});const minC=new BN(q.execution.minCollateralAfter).times(pc),debt=new BN(q.execution.debtAfter).times(pd); row.final={leverage:q.estimate.leverage,hf:q.estimate.healthFactor,minHF:minC.times(market.liquidationThreshold).div(debt.times(market.borrowWeight)).toFixed(12),minLeverage:minC.div(minC.minus(debt)).toFixed(12),quoteCount:row.calls.length};if(new BN(row.final.minHF).lt(minHF))throw new Error('ACCEPTED_UNSAFE_HF')}
 catch(e){row.error={code:e.code,message:e.message}}
 if(row.calls.length){const first=row.calls[0],input=new BN(first.request.amountIn),actual=new BN(first.quote.expectedOutput.amount),minimum=new BN(first.quote.minOutput.amount),rate=row.hint?new BN(row.hint.output.amount).div(row.hint.input.amount):(increasing?pd.div(pc):pc.div(pd)),predicted=floor(input.times(rate)),predictedMinimum=floor(predicted.times(slip))
 const metrics=(c,d)=>{const cv=c.times(pc),dv=d.times(pd);return {leverage:cv.div(cv.minus(dv)).toFixed(12),hf:dv.isZero()?null:cv.times(market.liquidationThreshold).div(dv.times(market.borrowWeight)).toFixed(12)}}
 let predictedMetrics,actualMetrics,worstMetrics
 if(increasing){const F=input.minus(opening?P:0),repay=ceil(F.times(ff)),debt=D.plus(repay).plus(floor(repay.times(bf)));predictedMetrics=metrics(C.plus(predicted),debt);actualMetrics=metrics(C.plus(actual),debt);worstMetrics=metrics(C.plus(minimum),debt)}
 else {const c=C.minus(input),repay=min=>BN.minimum(D,floor(min.div(ff)));predictedMetrics=metrics(c,D.minus(repay(predictedMinimum)));actualMetrics=metrics(c,D.minus(repay(minimum)));worstMetrics=actualMetrics}
 row.comparison={predictedOutput:predicted.toFixed(0),actualOutput:actual.toFixed(0),predictedMinimum:predictedMinimum.toFixed(0),actualMinimum:minimum.toFixed(0),outputDifferencePercent:actual.div(predicted).minus(1).times(100).toFixed(9),predictedMetrics,firstQuoteMetrics:actualMetrics,firstQuoteWorstCaseMetrics:worstMetrics,firstTargetRelativeErrorPercent:new BN(actualMetrics.leverage).div(target).minus(1).times(100).toFixed(9)}
 }
 report.rows.push(row);await save();console.log(JSON.stringify({strategy:id,principal,action:name,target,level,minHF,comparison:row.comparison,final:row.final,error:row.error}))
}
}
}));await save()
