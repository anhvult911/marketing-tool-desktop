import { NextResponse } from 'next/server';
import { getSetting } from '@/lib/db';

export async function POST(request: Request) {
  try {
    const { content, platform } = await request.json();
    if (!content || !platform) {
      return NextResponse.json({ success: false, error: 'Thiếu dữ liệu đầu vào.' }, { status: 400 });
    }

    const apiKey = getSetting('gemini_api_key', process.env.GEMINI_API_KEY || '').trim();

    if (!apiKey) {
      return NextResponse.json({ 
        success: false, 
        error: 'Chưa cấu hình Gemini API Key. Vui lòng vào Cài đặt (Settings) trên thanh công cụ để nhập khóa API.' 
      }, { status: 400 });
    }

    let systemPrompt = 'Tối ưu hóa bài viết sau cho mạng xã hội. Chỉ trả về văn bản kết quả.';
    if (platform === 'x') {
      systemPrompt = 'Tóm tắt bài viết sau thành bài viết ngắn dưới 280 ký tự phù hợp với mạng xã hội X (Twitter).';
    }

    const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`;
    
    const response = await fetch(geminiUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: `${systemPrompt}\n\nNội dung:\n${content}` }] }]
      })
    });

    if (!response.ok) {
      const errText = await response.text();
      throw new Error(`Gemini API Error: ${response.status} - ${errText}`);
    }

    const data = await response.json();
    const resultText = data.candidates?.[0]?.content?.parts?.[0]?.text;

    return NextResponse.json({ success: true, data: resultText ? resultText.trim() : content });
  } catch (error: any) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
