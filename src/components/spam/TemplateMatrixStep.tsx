import React, { useState } from 'react';

interface SpamTemplate {
  id: number;
  name: string;
  content: string;
}

interface TemplateMatrixStepProps {
  templates: SpamTemplate[];
  campSelectedTemplates: number[];
  setCampSelectedTemplates: React.Dispatch<React.SetStateAction<number[]>>;
  parseSpintax: (text: string) => string;
  setPreviewTemplate: (tpl: SpamTemplate | null) => void;
  setPreviewParsedText: (text: string) => void;
  campPlatform: string;
}

function validateSpintaxSyntax(text: string) {
  let depth = 0;
  for (let i = 0; i < text.length; i++) {
    if (text[i] === '{') depth++;
    if (text[i] === '}') depth--;
    if (depth < 0) return { valid: false, message: 'Thừa dấu ngoặc đóng "}"' };
  }
  if (depth !== 0) return { valid: false, message: 'Thiếu dấu ngoặc đóng "}" cho cú pháp Spintax' };
  return { valid: true, message: 'Cú pháp hợp lệ' };
}

function calculateSpintaxCombinations(text: string): number {
  const matches = text.match(/\{([^{}]+)\}/g);
  if (!matches) return 1;
  let combinations = 1;
  for (const m of matches) {
    const choices = m.slice(1, -1).split('|').length;
    combinations *= Math.max(1, choices);
  }
  return combinations;
}

export default function TemplateMatrixStep({
  templates,
  campSelectedTemplates,
  setCampSelectedTemplates,
  parseSpintax,
  setPreviewTemplate,
  setPreviewParsedText,
  campPlatform
}: TemplateMatrixStepProps) {
  const [inspectTemplateId, setInspectTemplateId] = useState<number | null>(null);

  const inspectedTpl = templates.find(t => t.id === inspectTemplateId);
  const syntaxCheck = inspectedTpl ? validateSpintaxSyntax(inspectedTpl.content) : null;
  const totalVars = inspectedTpl ? calculateSpintaxCombinations(inspectedTpl.content) : 0;

  // Render 3 sample variations for inspector
  const sampleVariations = inspectedTpl ? [
    parseSpintax(inspectedTpl.content),
    parseSpintax(inspectedTpl.content),
    parseSpintax(inspectedTpl.content)
  ] : [];

  return (
    <div className="card" style={{ padding: '1.5rem' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.5rem' }}>
        <h3 style={{ fontSize: '1rem', fontWeight: 600, color: 'var(--text-primary)', margin: 0 }}>
          Ma trận Kịch bản Spin Text ({campSelectedTemplates.length} đã chọn)
        </h3>
        <a href="/library" className="btn btn-secondary" style={{ fontSize: '0.75rem', padding: '0.25rem 0.60rem', height: 'auto' }}>
          📚 Quản lý thư viện
        </a>
      </div>
      <p style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', marginBottom: '1.25rem' }}>
        Hệ thống sẽ lấy ngẫu nhiên và spin nội dung kịch bản đã chọn để giảm tỷ lệ trùng lặp.
      </p>

      {templates.length === 0 ? (
        <div style={{ padding: '2rem', border: '1px dashed var(--border-color)', borderRadius: '8px', color: 'var(--text-secondary)', fontSize: '0.85rem', textAlign: 'center', backgroundColor: 'rgba(255,255,255,0.01)' }}>
          ⚠️ Thư viện kịch bản trống. Vui lòng tạo kịch bản mới trước.
        </div>
      ) : (
        <div className="selection-grid" style={{ marginBottom: '1.5rem' }}>
          {templates.map(tpl => {
            const isSelected = campSelectedTemplates.includes(tpl.id);
            const wordCount = tpl.content ? tpl.content.split(/\s+/).filter(Boolean).length : 0;
            const varsCount = calculateSpintaxCombinations(tpl.content);
            
            return (
              <div 
                key={tpl.id} 
                className={"script-select-card " + (isSelected ? 'selected' : '')}
                onClick={() => {
                  setCampSelectedTemplates(prev => 
                    prev.includes(tpl.id) ? prev.filter(id => id !== tpl.id) : [...prev, tpl.id]
                  );
                }}
              >
                <div className="card-checkbox-wrapper">
                  <input 
                    type="checkbox" 
                    checked={isSelected}
                    onChange={() => {}} 
                    style={{ pointerEvents: 'none' }}
                  />
                </div>

                <div className="card-details">
                  <span className="card-title">{tpl.name}</span>
                  <span className="card-subtitle" style={{ fontSize: '0.7rem' }}>
                    {tpl.content.substring(0, 50)}...
                  </span>
                  <div style={{ display: 'flex', gap: '0.35rem', marginTop: '0.25rem', flexWrap: 'wrap' }}>
                    <span className="badge badge-platform" style={{ fontSize: '0.6rem', padding: '0.1rem 0.35rem' }}>
                      📝 {wordCount} từ
                    </span>
                    <span className="badge badge-live" style={{ fontSize: '0.6rem', padding: '0.1rem 0.35rem', backgroundColor: 'rgba(46, 160, 67, 0.1)', color: 'var(--color-success)' }}>
                      🎲 {varsCount} biến thể
                    </span>
                    <button 
                      type="button" 
                      onClick={(e) => {
                        e.stopPropagation(); 
                        setInspectTemplateId(inspectTemplateId === tpl.id ? null : tpl.id);
                      }}
                      className="btn" 
                      style={{ fontSize: '0.6rem', padding: '0.1rem 0.35rem', height: 'auto', background: inspectTemplateId === tpl.id ? 'var(--color-primary-hover)' : 'rgba(255,255,255,0.08)', color: '#fff' }}
                    >
                      🔬 Inspector
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Inline Spintax Inspector Panel */}
      {inspectedTpl && (
        <div style={{ padding: '1.25rem', border: '1px solid var(--color-primary-hover)', borderRadius: '10px', backgroundColor: 'rgba(47, 129, 247, 0.04)', marginTop: '1rem' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.75rem' }}>
            <h4 style={{ fontSize: '0.9rem', fontWeight: 700, color: 'var(--text-primary)', margin: 0, display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
              🔬 Trình kiểm tra Spintax Syntax & Biến thể: {inspectedTpl.name}
            </h4>
            <button type="button" onClick={() => setInspectTemplateId(null)} style={{ border: 'none', background: 'none', color: 'var(--text-secondary)', cursor: 'pointer' }}>✕</button>
          </div>

          {/* Syntax Status */}
          <div style={{ display: 'flex', gap: '1rem', marginBottom: '1rem', flexWrap: 'wrap' }}>
            <div style={{ padding: '0.5rem 0.85rem', borderRadius: '6px', backgroundColor: syntaxCheck?.valid ? 'rgba(63, 185, 80, 0.1)' : 'rgba(248, 81, 73, 0.1)', border: syntaxCheck?.valid ? '1px solid var(--color-success)' : '1px solid var(--color-danger)', fontSize: '0.78rem', color: syntaxCheck?.valid ? 'var(--color-success)' : 'var(--color-danger)', fontWeight: 600 }}>
              {syntaxCheck?.valid ? '✓ Cú pháp ngoặc Spintax chuẩn xác' : `⚠️ Lỗi cú pháp: ${syntaxCheck?.message}`}
            </div>
            <div style={{ padding: '0.5rem 0.85rem', borderRadius: '6px', backgroundColor: 'rgba(255,255,255,0.05)', border: '1px solid var(--border-color)', fontSize: '0.78rem', color: 'var(--text-primary)', fontWeight: 600 }}>
              📊 Tổng số biến thể có thể sinh ra: <strong style={{ color: 'var(--color-primary-hover)' }}>{totalVars} mẫu khác nhau</strong>
            </div>
          </div>

          {/* Sample matrix grid */}
          <div>
            <span style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--text-secondary)', display: 'block', marginBottom: '0.5rem' }}>
              Xem thử 3 mẫu ngẫu nhiên sinh ra từ kịch bản:
            </span>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: '0.75rem' }}>
              {sampleVariations.map((sample, idx) => (
                <div key={idx} style={{ padding: '0.75rem', backgroundColor: 'var(--bg-secondary)', border: '1px solid var(--border-color)', borderRadius: '6px', fontSize: '0.75rem', color: 'var(--text-primary)', fontStyle: 'italic', lineHeight: 1.4 }}>
                  <span style={{ fontSize: '0.65rem', color: 'var(--color-primary-hover)', display: 'block', marginBottom: '0.25rem', fontWeight: 600 }}>Mẫu ngẫu nhiên #{idx + 1}:</span>
                  "{sample}"
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
