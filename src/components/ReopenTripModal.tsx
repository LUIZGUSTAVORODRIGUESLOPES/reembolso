import React, { useState } from 'react'
import { Unlock, ShieldCheck, Loader2 } from 'lucide-react'
import { Trip } from '@/types/database'
import { TRIP_STATUS_CONFIG } from '@/lib/formatters'
import { storageService } from '@/services/storageService'
import { useAuth } from '@/hooks/use-auth'
import { useToast } from '@/hooks/use-toast'
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogCancel,
} from '@/components/ui/alert-dialog'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'

export interface ReopenTripModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  trip: Trip | null
  onSuccess?: (reopenedTrip: Trip) => void
}

export function ReopenTripModal({ open, onOpenChange, trip, onSuccess }: ReopenTripModalProps) {
  const { user, profile, isAdmin } = useAuth()
  const { toast } = useToast()
  const [reopenReason, setReopenReason] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)

  // Reset reason when modal opens/closes
  const handleOpenChange = (nextOpen: boolean) => {
    if (!nextOpen) {
      setReopenReason('')
    }
    onOpenChange(nextOpen)
  }

  const handleConfirm = async () => {
    if (!trip) return

    if (!isAdmin) {
      toast({
        title: 'Ação restrita',
        description: 'Apenas administradores podem reabrir viagens fechadas ou auditadas.',
        variant: 'destructive',
      })
      return
    }

    const trimmed = reopenReason.trim()
    if (!trimmed || trimmed.length < 10) {
      toast({
        title: 'Motivo insuficiente',
        description:
          'Por favor, descreva o motivo da reabertura com no mínimo 10 caracteres explicativos.',
        variant: 'destructive',
      })
      return
    }

    if (trip.status === 'reembolsada') {
      toast({
        title: 'Viagem quitada',
        description:
          'Viagens com status "reembolsada" não podem ser reabertas. A quitação é definitiva.',
        variant: 'destructive',
      })
      return
    }

    setIsSubmitting(true)
    try {
      const currentUserName =
        profile?.full_name ||
        user?.user_metadata?.full_name ||
        user?.user_metadata?.name ||
        user?.email ||
        'Administrador'

      const updated = await storageService.reopenTrip({
        tripId: trip.id,
        reason: trimmed,
        user: user ? { id: user.id, name: currentUserName } : null,
      })

      toast({
        title: 'Viagem reaberta com sucesso!',
        description: `A viagem "${trip.destination}" voltou para "Em Triagem". Você já pode incluir novos comprovantes.`,
      })

      handleOpenChange(false)
      if (updated && onSuccess) {
        onSuccess(updated)
      }
    } catch (err: any) {
      console.error('Erro ao reabrir viagem:', err)
      toast({
        title: 'Falha ao reabrir viagem',
        description: storageService.formatDatabaseError(err),
        variant: 'destructive',
      })
    } finally {
      setIsSubmitting(false)
    }
  }

  if (!trip) return null

  const statusLabel = TRIP_STATUS_CONFIG[trip.status]?.label || trip.status

  return (
    <AlertDialog open={open} onOpenChange={handleOpenChange}>
      <AlertDialogContent className="sm:max-w-lg">
        <AlertDialogHeader>
          <AlertDialogTitle className="text-amber-900 flex items-center gap-2 text-base">
            <Unlock className="w-5 h-5 text-amber-600" />
            Reabertura de Viagem (Fluxo de Governança)
          </AlertDialogTitle>
          <AlertDialogDescription className="text-slate-600 text-xs sm:text-sm space-y-3 pt-1">
            <p>
              A viagem para <strong className="text-slate-900">{trip.destination}</strong> voltará
              do status <strong className="text-amber-800">{statusLabel}</strong> para{' '}
              <strong className="text-blue-700">Em Triagem</strong>.
            </p>

            <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 text-xs text-amber-950 space-y-1.5 leading-relaxed">
              <p className="font-semibold flex items-center gap-1.5 text-amber-900">
                <ShieldCheck className="w-4 h-4 text-amber-700" />
                Rastreabilidade e Desbloqueio:
              </p>
              <ul className="list-disc list-inside space-y-1 text-amber-900/90">
                <li>
                  A viagem será desbloqueada para inclusão, edição e exclusão de comprovantes.
                </li>
                <li>O histórico e o motivo da reabertura ficarão permanentemente gravados.</li>
                <li>
                  Após a inclusão dos comprovantes, a prestação poderá ser revisada e fechada.
                </li>
              </ul>
            </div>

            <div className="space-y-1.5 pt-1">
              <Label
                htmlFor="reopen-trip-reason-input"
                className="text-xs font-semibold text-slate-800 flex items-center justify-between"
              >
                <span>Motivo obrigatório da reabertura:</span>
                <span
                  className={`text-[11px] font-normal ${
                    reopenReason.trim().length >= 10
                      ? 'text-emerald-600 font-semibold'
                      : 'text-slate-400'
                  }`}
                >
                  {reopenReason.trim().length}/10 caracteres mín.
                </span>
              </Label>
              <Textarea
                id="reopen-trip-reason-input"
                rows={3}
                value={reopenReason}
                onChange={(e) => setReopenReason(e.target.value)}
                placeholder="Ex: Inclusão de comprovante complementar que faltava no fechamento..."
                className="text-xs resize-none"
                disabled={isSubmitting}
                autoFocus
              />
            </div>
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter className="pt-2">
          <AlertDialogCancel disabled={isSubmitting}>Cancelar</AlertDialogCancel>
          <Button
            type="button"
            onClick={handleConfirm}
            disabled={isSubmitting || reopenReason.trim().length < 10 || !isAdmin}
            className="bg-amber-600 hover:bg-amber-700 text-white font-semibold text-xs gap-1.5"
          >
            {isSubmitting ? (
              <>
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
                <span>Reabrindo Viagem...</span>
              </>
            ) : (
              <>
                <Unlock className="w-3.5 h-3.5" />
                <span>Confirmar Reabertura</span>
              </>
            )}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
