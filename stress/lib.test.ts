import 'fake-indexeddb/auto';
import { describe, it, expect } from 'vitest';
import * as XLSX from 'xlsx';
import { booksToCsv, csvToBooks, booksToJson, jsonToBooks, booksToXlsx, xlsxToBooks, mergeBooks } from '../src/lib/io';
import { checkIsbn, looksLikeIsbn } from '../src/lib/isbn';
import { parseAudibleCsv, parseAudibleJson, planAudibleImport } from '../src/lib/audible';
import { lookupIsbn } from '../src/lib/lookup';
import { db } from '../src/lib/db';
import type { Book } from '../src/lib/types';
const log=(...a:any[])=>console.log('[R]',...a);
const now='2026-10-01T00:00:00.000Z';
function mk(i:number,o:Partial<Book>={}):Book{return {id:'id'+i,title:'Book '+i,authors:'Author '+(i%300),formats:['Print'],narrators:'',length:'',asin:'',isbn13:'',isbn10:'',publisher:'P',year:'2000',pages:'100',coverUrl:'',shelf:'S'+(i%20),notes:'n',readDates:i%3?[]:['2020-01-01'],addedAt:now,updatedAt:now,...o};}
const tig='ፍቕሪ ኣብ ግዜ ኮሌራ ትግርኛ ሰላም';
it('volume', async()=>{
 for (const n of [2000,10000]){
  const books=Array.from({length:n},(_,i)=>mk(i,{title:i%7?'Book '+i:tig+' '+i}));
  let t=performance.now(); const csv=booksToCsv(books); const c=csvToBooks(csv); log(n,'csv rt ms',Math.round(performance.now()-t),c.length);
  t=performance.now(); const x=xlsxToBooks(booksToXlsx(books)); log(n,'xlsx rt ms',Math.round(performance.now()-t),x.length);
  t=performance.now(); const j=jsonToBooks(booksToJson(books)); log(n,'json rt ms',Math.round(performance.now()-t),j.length);
  t=performance.now(); const p=mergeBooks([],c); log(n,'merge ms',Math.round(performance.now()-t),p.added);
  await db.books.clear(); t=performance.now(); await db.books.bulkPut(p.put); log(n,'idb bulkPut ms (fake-idb)',Math.round(performance.now()-t), await db.books.count());
  t=performance.now(); const p2=mergeBooks(await db.books.toArray(),c); log(n,'re-import plan',p2.added,p2.updated,p2.unchanged,Math.round(performance.now()-t));
  expect(x.length).toBe(n);
 }
});
it('roundtrip fidelity', ()=>{
 const b=[mk(1,{title:tig,notes:'line1\nline2, "q"',isbn13:'9780306406157',isbn10:'0306406152',readDates:['2020-01-01','2021-05-05','2021-05-05']}),
  mk(2,{title:'X'.repeat(40000)}), mk(3,{title:'=HYPERLINK("http://evil","x")'}), mk(4,{isbn10:'012345678X',pages:'00123',year:'0099'})];
 for (const [k,out] of [['csv',csvToBooks(booksToCsv(b))],['json',jsonToBooks(booksToJson(b))]] as const){
  out.forEach((o,i)=>{for(const f of Object.keys(b[i]) as (keyof Book)[]) if(JSON.stringify(o[f])!==JSON.stringify(b[i][f])) log(k,'diff',i,f,String(o[f]).slice(0,40));});
 }
 try{ const x=xlsxToBooks(booksToXlsx(b)); x.forEach((o,i)=>{for(const f of Object.keys(b[i]) as (keyof Book)[]) if(JSON.stringify(o[f])!==JSON.stringify(b[i][f])) log('xlsx diff',i,f,String(o[f]).slice(0,40), String(o[f]).length);}); }catch(e){log('xlsx export threw',(e as Error).message);}
 log('csv formula cell raw:', booksToCsv([b[2]]).split('\r\n')[1].slice(0,60));
});
it('isbn', ()=>{
 for (const s of ['978-0-306-40615-7','0-306-40615-2','080442957X','080442957x','9780306406158','12345','9790000000001','1234567890123',' 978 0306406157 ','ISBN 978-0-306-40615-7','978\u20110306406157'])
  log('isbn',JSON.stringify(s),looksLikeIsbn(s),JSON.stringify(checkIsbn(s)));
 log('title "2001 2010 1999" treated as isbn?',looksLikeIsbn('2001 2010 1999'));
});
it('csv bad input', ()=>{
 try{ const r=csvToBooks('Title,Author,ISBN\n,,\n"unterminated,a,b\nGood,A,978-0-306-40615-7\nTen,A,0-306-40615-2\nBad,A,9780306406158\n'); log('loose csv',JSON.stringify(r.map(b=>[b.title,b.isbn13,b.isbn10]))); }catch(e){ log('malformed csv rejected:',(e as Error).message); }
 const rOk=csvToBooks('Title,Author,ISBN\n,,\nGood,A,978-0-306-40615-7\nTen,A,0-306-40615-2\nBad,A,9780306406158\n'); log('loose csv (no bad quote)',JSON.stringify(rOk.map(b=>[b.title,b.isbn13,b.isbn10])));
 const r2=csvToBooks('Title,ISBN10\nA,0-306-40615-2\n'); log('isbn10 col',JSON.stringify(r2.map(b=>[b.isbn13,b.isbn10])));
 const r3=csvToBooks('id,title,readDates\n1,A,"2099-01-01; not-a-date; 2020-13-45"\n'); log('readDates',JSON.stringify(r3[0].readDates));
 for (const t of ['null','42','{"foo":1}','{"books":null}','not json{','']) { try{log('json',JSON.stringify(t),jsonToBooks(t).length);}catch(e){log('json throws',JSON.stringify(t),(e as Error).message);} }
 try{log('garbage xlsx',xlsxToBooks(new TextEncoder().encode('hello').buffer).length);}catch(e){log('xlsx throws',(e as Error).message);}
 const csvBracket=csvToBooks('[Draft] title,x\n'); log('csv header only',csvBracket.length);
});
it('merge dupes', ()=>{
 const inFile=[mk(1,{id:'a',isbn13:'9780306406157'}),mk(2,{id:'b',isbn13:'9780306406157'})];
 log('same isbn twice in one file -> added',mergeBooks([],inFile).added);
 const noid=csvToBooks('title,author\nDune,Frank Herbert\n'); const p=mergeBooks([],noid);
 const p2=mergeBooks(p.put,csvToBooks('title,author\nDune,Frank Herbert\n')); log('id-less reimport',p2.added,p2.updated,p2.unchanged);
 const print=mk(10,{id:'p',title:'Dune',authors:'Frank Herbert',formats:['Print']});
 const audio=mk(11,{id:'au',title:'Dune',authors:'Frank Herbert',formats:['Audiobook'],asin:'B002V1OF70',updatedAt:'2026-10-02T00:00:00.000Z'});
 const pm=mergeBooks([print],[{...audio,id:'zz'}]); log('generic import audiobook vs existing print',pm.added,pm.updated,pm.put[0]?.id,pm.put[0]?.formats);
 const pm2=mergeBooks([],[print,{...audio}]); log('both in fresh file',pm2.added);
 const ap=planAudibleImport([print],[{title:'Dune',authors:'Frank Herbert',narrators:'',length:'',asin:'B002V1OF70',coverUrl:'',isbn13:'',isbn10:''}]); log('audible vs print',ap.newCount);
 const isbnClash=mergeBooks([mk(1,{id:'p',isbn13:'9780306406157'})],[mk(2,{id:'q',isbn13:'9780306406157',formats:['Audiobook'],updatedAt:'2027-01-01'})]); log('print+audio same isbn13 merge',isbnClash.added,isbnClash.updated);
});
it('audible', async()=>{
 const fs=await import('fs');
 const j=parseAudibleJson(fs.readFileSync('tests/fixtures/ale-library.json','utf8')); const c=parseAudibleCsv(fs.readFileSync('tests/fixtures/ale-library.csv','utf8'));
 log('ale json',j.length,'csv',c.length);
 const p1=planAudibleImport([],j); const p2=planAudibleImport(p1.add,c); log('json then csv new',p2.newCount,p2.existingCount);
 const p3=planAudibleImport(p1.add,j); log('reimport json new',p3.newCount);
 log('missing fields', JSON.stringify(parseAudibleJson('{"library":[{"asin":"B1","title":"T"},{"asin":"B2"},{"title":"NoAsin"},{"asin":"B3","title":"X","authors":null,"narrators":[{}],"length":null,"cover":12}]}')));
 try{ log(parseAudibleCsv('ASIN,Title,Length\nB1,,\n,Only title,\n').length);}catch(e){log('csv throw',(e as Error).message);}
 try{ parseAudibleJson('{"library":[]}'); log('empty lib ok');}catch(e){log('empty',(e as Error).message);}
 // asin in file but different title casing
 const a=planAudibleImport([],[{title:'Dune',authors:'Frank Herbert',narrators:'',length:'',asin:'',coverUrl:'',isbn13:'',isbn10:''},{title:'Dune: Book One',authors:'Frank Herbert',narrators:'',length:'',asin:'B9',coverUrl:'',isbn13:'',isbn10:''}]);
 log('Dune vs Dune: Book One different asin', a.newCount, a.skippedInFile);
});
it('lookup failures', async()=>{ (globalThis as any).navigator ??= {onLine:true}; Object.defineProperty(globalThis,'navigator',{value:{onLine:true},configurable:true});
 const g:any=globalThis; const orig=g.fetch;
 g.fetch=async()=>{throw new TypeError('Failed to fetch')}; log('both down',JSON.stringify(await lookupIsbn('9780306406157')));
 g.fetch=async(u:string)=>u.includes('openlibrary')?new Response('x',{status:503}):new Response(JSON.stringify({items:[{volumeInfo:{title:'GB'}}]}),{status:200}); log('OL 503 -> GB',JSON.stringify(await lookupIsbn('9780306406157')).slice(0,80));
 g.fetch=async(u:string)=>u.includes('openlibrary')?new Response('x',{status:503}):new Response('{"totalItems":0}',{status:200}); log('OL down + GB none',JSON.stringify(await lookupIsbn('9780306406157')));
 g.fetch=async(u:string)=>u.includes('openlibrary')?new Response('x',{status:404}):new Response('rate',{status:429}); log('OL 404 + GB 429',JSON.stringify(await lookupIsbn('9780306406157')));
 g.fetch=async(u:string)=>new Response('<html>',{status:200}); log('html 200',JSON.stringify(await lookupIsbn('9780306406157')));
 g.fetch=orig;
});
it('series', ()=>{
 const mkA=(t:string,a:string)=>({title:t,authors:'J.K. Rowling',narrators:'',length:'',asin:a,coverUrl:'',isbn13:'',isbn10:''});
 const p=planAudibleImport([],[mkA('Harry Potter: Book 1','B1'),mkA('Harry Potter: Book 2','B2')]); log('series in file',p.newCount,p.skippedInFile);
 const p2=planAudibleImport(p.add,[mkA('Harry Potter: Book 3','B3')]); log('series later purchase',p2.newCount,p2.existingCount);
});
