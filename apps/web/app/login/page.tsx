'use client'
import { useRouter } from 'next/navigation'
import LoginPage from '@/components/login-page'

export default function LoginRoute() {
  const router = useRouter()
  return <LoginPage onLogin={() => router.replace('/')} />
}
