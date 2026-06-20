'use client'
import LoginPage from '@/components/login-page'

export default function LoginRoute() {
  return <LoginPage onLogin={() => { window.location.replace('/') }} />
}
