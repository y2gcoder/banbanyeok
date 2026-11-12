import { ImageResponse } from 'next/og';
export const dynamic = 'force-dynamic';
export async function GET(request: Request) {
  const start = performance.now();
  const full = new URL(request.url).searchParams.has('full');
  const font = await fetch(new URL(`/fonts/NotoSansKR-${full ? 'full' : 'og'}.otf`, request.url)).then(r => r.arrayBuffer());
  const response = new ImageResponse(
    <div style={{display:'flex',width:'100%',height:'100%',background:'#f4f1e8',alignItems:'center',justifyContent:'center',fontFamily:'Noto',fontSize:68}}>반반역 · 가장 공평한 만남</div>,
    { width:1200,height:630,fonts:[{name:'Noto',data:font,weight:400,style:'normal'}] }
  );
  // Reading the PNG consumes lazy ImageResponse work before the measurement ends.
  const png = await response.arrayBuffer();
  return new Response(png,{headers:{'Content-Type':'image/png','Cache-Control':'no-store','Server-Timing':`og;dur=${(performance.now()-start).toFixed(2)}`}});
}
