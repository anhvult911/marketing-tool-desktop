'use client';

import React, { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    
    if (!email || !password) {
      setError('Vui lòng điền đầy đủ Tên đăng nhập và Mật khẩu.');
      return;
    }

    setLoading(true);

    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
      });

      const data = await res.json();

      if (!res.ok) {
        setError(data.error || 'Đăng nhập thất bại.');
      } else {
        router.push('/');
        router.refresh();
      }
    } catch (err) {
      setError('Đã xảy ra lỗi kết nối. Vui lòng thử lại.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="auth-wrapper">
      <style dangerouslySetInnerHTML={{ __html: `
        .auth-wrapper {
          display: flex;
          align-items: center;
          justify-content: center;
          min-height: 100vh;
          width: 100vw;
          background: radial-gradient(circle at center, var(--bg-tertiary) 0%, var(--bg-primary) 100%);
          padding: 20px;
        }

        .auth-card {
          width: 100%;
          max-width: 440px;
          background: var(--bg-card);
          backdrop-filter: blur(12px);
          -webkit-backdrop-filter: blur(12px);
          border: 1px solid var(--border-subtle);
          border-radius: 16px;
          padding: 40px;
          box-shadow: 0 8px 32px 0 rgba(0, 0, 0, 0.37);
        }

        .auth-header {
          text-align: center;
          margin-bottom: 30px;
        }

        .auth-title {
          font-size: 28px;
          font-weight: 700;
          color: #f0f6fc;
          margin-bottom: 8px;
          letter-spacing: -0.5px;
          background: linear-gradient(90deg, #58a6ff, #2f81f7);
          -webkit-background-clip: text;
          -webkit-text-fill-color: transparent;
        }

        .auth-subtitle {
          font-size: 14px;
          color: #8b949e;
        }

        .auth-form-group {
          margin-bottom: 20px;
          display: flex;
          flex-direction: column;
          gap: 8px;
        }

        .auth-label {
          font-size: 13px;
          font-weight: 500;
          color: #c9d1d9;
          text-align: left;
        }

        .auth-input {
          width: 100%;
          padding: 12px 16px;
          background: #0d1117;
          border: 1px solid #30363d;
          border-radius: 8px;
          color: #f0f6fc;
          font-size: 14px;
          font-family: inherit;
          transition: border-color 0.2s, box-shadow 0.2s;
        }

        .auth-input:focus {
          outline: none;
          border-color: #2f81f7;
          box-shadow: 0 0 0 3px rgba(47, 129, 247, 0.3);
        }

        .auth-error {
          background: rgba(248, 81, 73, 0.1);
          border: 1px solid rgba(248, 81, 73, 0.2);
          color: #f85149;
          border-radius: 8px;
          padding: 12px;
          font-size: 13px;
          margin-bottom: 20px;
          text-align: left;
          display: flex;
          align-items: center;
          gap: 8px;
        }

        .auth-btn {
          width: 100%;
          padding: 12px;
          background: #2f81f7;
          border: none;
          border-radius: 8px;
          color: white;
          font-weight: 600;
          font-size: 14px;
          cursor: pointer;
          transition: background-color 0.2s, transform 0.1s;
          display: flex;
          align-items: center;
          justify-content: center;
          margin-top: 10px;
        }

        .auth-btn:hover:not(:disabled) {
          background: #58a6ff;
        }

        .auth-btn:active:not(:disabled) {
          transform: scale(0.98);
        }

        .auth-btn:disabled {
          opacity: 0.6;
          cursor: not-allowed;
        }

        .auth-footer {
          text-align: center;
          margin-top: 24px;
          font-size: 13px;
          color: #8b949e;
        }

        .auth-link {
          color: #2f81f7;
          font-weight: 500;
          text-decoration: none;
          transition: color 0.2s;
        }

        .auth-link:hover {
          color: #58a6ff;
          text-decoration: underline;
        }

        /* Spinner */
        .spinner {
          width: 18px;
          height: 18px;
          border: 2px solid rgba(255, 255, 255, 0.3);
          border-top: 2px solid white;
          border-radius: 50%;
          animation: spin 0.8s linear infinite;
        }

        @keyframes spin {
          0% { transform: rotate(0deg); }
          100% { transform: rotate(360deg); }
        }
      ` }} />

      <div className="auth-card">
        <div className="auth-header">
          <h1 className="auth-title">MKT Tools</h1>
          <p className="auth-subtitle">Đăng nhập để quản lý tài khoản & chiến dịch</p>
        </div>

        {error && (
          <div className="auth-error">
            <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
              <path fillRule="evenodd" d="M8 15A7 7 0 108 1a7 7 0 000 14zM8 4a.75.75 0 01.75.75v3.5a.75.75 0 01-1.5 0v-3.5A.75.75 0 018 4zm0 6a1 1 0 100 2 1 1 0 000-2z" />
            </svg>
            <span>{error}</span>
          </div>
        )}

        <form onSubmit={handleSubmit}>
          <div className="auth-form-group">
            <label className="auth-label">Tên đăng nhập (Username)</label>
            <input
              type="text"
              className="auth-input"
              placeholder="Nhập tên đăng nhập..."
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              disabled={loading}
              required
            />
          </div>

          <div className="auth-form-group">
            <label className="auth-label">Mật khẩu</label>
            <input
              type="password"
              className="auth-input"
              placeholder="••••••••"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              disabled={loading}
              required
            />
          </div>

          <button type="submit" className="auth-btn" disabled={loading}>
            {loading ? <div className="spinner" /> : 'Đăng nhập'}
          </button>
        </form>

        <div className="auth-footer">
          Chưa có tài khoản?{' '}
          <Link href="/register" className="auth-link">
            Đăng ký ngay
          </Link>
        </div>
      </div>
    </div>
  );
}
