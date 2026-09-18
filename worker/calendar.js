// Compute calendar boundaries in Israel, including 23/25-hour daylight-saving days.
const format=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Jerusalem',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23'});
const parts=ms=>Object.fromEntries(format.formatToParts(new Date(ms)).filter(p=>p.type!=='literal').map(p=>[p.type,Number(p.value)]));
function midnight(y,m,d){const desired=Date.UTC(y,m-1,d);let guess=desired;for(let i=0;i<4;i++){const p=parts(guess);const observed=Date.UTC(p.year,p.month-1,p.day,p.hour,p.minute,p.second);guess+=desired-observed;}return guess/1000;}
export function learningDayBounds(seconds){const p=parts(seconds*1000),next=new Date(Date.UTC(p.year,p.month-1,p.day+1));return {start:midnight(p.year,p.month,p.day),end:midnight(next.getUTCFullYear(),next.getUTCMonth()+1,next.getUTCDate())};}
