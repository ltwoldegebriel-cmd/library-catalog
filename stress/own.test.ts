import { it } from 'vitest';
import { COLUMNS, booksToCsv } from '../src/lib/io';
import { isAudibleHeaders, parseAudibleCsv, planAudibleImport } from '../src/lib/audible';
it('own export detected as audible',()=>{
 const csv=booksToCsv([{id:'1',title:'Dune',authors:'Frank Herbert',formats:['Print'],narrators:'',length:'',asin:'',isbn13:'9780441172719',isbn10:'',publisher:'Ace',year:'1965',pages:'600',coverUrl:'',shelf:'Den',notes:'gift',readDates:['2020-01-01'],addedAt:'x',updatedAt:'x'}]);
 console.log('[R] audible?',isAudibleHeaders(COLUMNS as string[]));
 try{ const b=planAudibleImport([],parseAudibleCsv(csv)).add[0]; console.log('[R] BUG: routed to Audible',JSON.stringify(b)); }catch(e){ console.log('[R] own CSV rejected by Audible parser:',(e as Error).message); }
 console.log('[R] own header (current) audible?',isAudibleHeaders(csv.split('\r\n')[0].split(',')));
});
