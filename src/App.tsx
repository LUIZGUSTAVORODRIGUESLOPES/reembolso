/* Main App Component - Handles routing (using react-router-dom), query client and other providers - use this file to add all routes */
import { BrowserRouter, Routes, Route } from 'react-router-dom'
import { Toaster } from '@/components/ui/toaster'
import { Toaster as Sonner } from '@/components/ui/sonner'
import { TooltipProvider } from '@/components/ui/tooltip'
import { AuthProvider } from '@/hooks/use-auth'
import { ProtectedRoute } from '@/components/ProtectedRoute'
import Index from './pages/Index'
import NotFound from './pages/NotFound'
import Layout from './components/Layout'
import UploadPage from './pages/UploadPage'
import TriagePage from './pages/TriagePage'
import TripDetailPage from './pages/TripDetailPage'
import ReportsPage from './pages/ReportsPage'
import TripsPage from './pages/TripsPage'
import LoginPage from './pages/LoginPage'
import UsersPage from './pages/UsersPage'

const App = () => (
  <BrowserRouter>
    <AuthProvider>
      <TooltipProvider>
        <Toaster />
        <Sonner />
        <Routes>
          <Route path="/login" element={<LoginPage />} />

          <Route
            element={
              <ProtectedRoute>
                <Layout />
              </ProtectedRoute>
            }
          >
            <Route path="/" element={<Index />} />
            <Route path="/trips" element={<TripsPage />} />
            <Route path="/trips/:id" element={<TripDetailPage />} />
            <Route path="/avulsas" element={<SolicitacoesAvulsasPage />} />
            <Route path="/upload" element={<UploadPage />} />{' '}
            <Route path="/triage" element={<TriagePage />} />
            <Route path="/reports" element={<ReportsPage />} />
            <Route
              path="/usuarios"
              element={
                <ProtectedRoute requireAdmin>
                  <UsersPage />
                </ProtectedRoute>
              }
            />
          </Route>
          <Route path="*" element={<NotFound />} />
        </Routes>
      </TooltipProvider>
    </AuthProvider>
  </BrowserRouter>
)

export default App
