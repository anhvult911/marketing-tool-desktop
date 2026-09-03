'use client';

import React, { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';

export default function RegisterPage() {
  const router = useRouter();
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setSuccess('');
    
    if (!fullName || !email || !password || !confirmPassword) {
      setError('Vui lòng điền đầy đủ tất cả thông tin.');
      return;
    }

    const usernameRegex = /^[a-zA-Z0-9_.]+$/;
    if (email.trim().length < 3 || !usernameRegex.test(email.trim())) {
      setError('Tên đăng nhập không hợp lệ (tối thiểu 3 ký tự, chỉ chứa chữ cái, số, dấu gạch dưới và dấu chấm).');
      return;
    }

    if (password !== confirmPassword) {
      setError('Mật khẩu nhập lại không khớp.');
      return;
    }

    if (password.length < 6) {
      setError('Mật khẩu phải chứa ít nhất 6 ký tự.');
      return;
    }

    setLoading(true);

    try {
      const res = await fetch('/api/auth/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fullName, email, password }),
      });

      const data = await res.json();

      if (!res.ok) {
        setError(data.error || 'Đăng ký tài khoản thất bại.');
      } else {
        setSuccess('Đăng ký tài khoản thành công! Đang chuyển hướng...');
        setTimeout(() => {
          router.push('/');
          router.refresh();
        }, 1500);
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
          margin-bottom: 18px;
          display: flex;
          flex-direction: column;
          gap: 6px;
        }

        .auth-label {
          font-size: 13px;
          font-weight: 500;
          color: #c9d1d9;
          text-align: left;
        }

        .auth-input {
          width: 100%;
          padding: 11px 14px;
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

        .auth-success {
          background: rgba(63, 185, 80, 0.1);
          border: 1px solid rgba(63, 185, 80, 0.2);
          color: #3fb950;
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
          background: #3fb950;
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
          background: #4ae15e;
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
          <p className="auth-subtitle">Tạo tài khoản mới và bắt đầu chiến dịch</p>
        </div>

        {error && (
          <div className="auth-error">
            <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
              <path fillRule="evenodd" d="M8 15A7 7 0 108 1a7 7 0 000 14zM8 4a.75.75 0 01.75.75v3.5a.75.75 0 01-1.5 0v-3.5A.75.75 0 018 4zm0 6a1 1 0 100 2 1 1 0 000-2z" />
            </svg>
            <span>{error}</span>
          </div>
        )}

        {success && (
          <div className="auth-success">
            <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
              <path fillRule="evenodd" d="M8 15A7 7 0 108 1a7 7 0 000 14zm3.78-7.22a.75.75 0 00-1.06-1.06L7 9.44 5.28 7.72a.75.75 0 00-1.06 1.06l2.25 2.25a.75.75 0 001.06 0l4.25-4.25z" />
            </svg>
            <span>{success}</span>
          </div>
        )}

        <form onSubmit={handleSubmit}>
          <div className="auth-form-group">
            <label className="auth-label">Họ tên của bạn</label>
            <input
              type="text"
              className="auth-input"
              placeholder="Nguyễn Văn A"
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
              disabled={loading || !!success}
              required
            />
          </div>

          <div className="auth-form-group">
            <label className="auth-label">Tên đăng nhập (Username)</label>
            <input
              type="text"
              className="auth-input"
              placeholder="vutran, anhvu..."
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              disabled={loading || !!success}
              required
            />
          </div>

          <div className="auth-form-group">
            <label className="auth-label">Mật khẩu</label>
            <input
              type="password"
              className="auth-input"
              placeholder="Tối thiểu 6 ký tự"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              disabled={loading || !!success}
              required
            />
          </div>

          <div className="auth-form-group">
            <label className="auth-label">Xác nhận mật khẩu</label>
            <input
              type="password"
              className="auth-input"
              placeholder="Nhập lại mật khẩu"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              disabled={loading || !!success}
              required
            />
          </div>

          <button type="submit" className="auth-btn" disabled={loading || !!success}>
            {loading ? <div className="spinner" /> : 'Đăng ký tài khoản'}
          </button>
        </form>

        <div className="auth-footer">
          Đã có tài khoản?{' '}
          <Link href="/login" className="auth-link">
            Đăng nhập ngay
          </Link>
        </div>
      </div>
    </div>
  );
}
