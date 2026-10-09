import { toast as sonnerToast } from 'sonner'
import { storageService } from '@/services/storageService'
import { userService } from '@/services/userService'
import { Expense, Trip, Profile } from '@/types/database'
import { formatCurrencyBRL } from '@/lib/formatters'

import { StandaloneRequest } from '@/types/database'
import { standaloneRequestService } from '@/services/standaloneRequestService'

export type LastDeletedItem =
  | {
      type: 'expense'
      data: Expense
      tripDestination?: string
    }
  | {
      type: 'trip'
      data: Trip
      expenses: Expense[]
    }
  | {
      type: 'standalone_request'
      data: StandaloneRequest
    }
  | {
      type: 'user_deactivation'
      user: Profile
      previousActiveState: boolean
    }

class UndoManagerService {
  private lastAction: LastDeletedItem | null = null
  private clearTimer: ReturnType<typeof setTimeout> | null = null

  /**
   * Registra a última ação com um timer para limpar da memória após expiração da janela.
   */
  public registerAction(action: LastDeletedItem, durationMs = 10000) {
    if (this.clearTimer) {
      clearTimeout(this.clearTimer)
    }
    this.lastAction = action
    this.clearTimer = setTimeout(() => {
      if (this.lastAction === action) {
        this.lastAction = null
      }
    }, durationMs + 2000)
  }

  public getLastAction(): LastDeletedItem | null {
    return this.lastAction
  }

  public clearLastAction() {
    if (this.clearTimer) {
      clearTimeout(this.clearTimer)
      this.clearTimer = null
    }
    this.lastAction = null
  }
}

export const undoManager = new UndoManagerService()

/**
 * Notifica exclusão de despesa com botão "Desfazer" interativo (sonner action) por 10 segundos.
 */
export function showExpenseDeletedUndoToast(options: {
  expense: Expense
  tripDestination?: string
  onRestored?: (restored: Expense) => void
  onRestoreFailed?: (err: any) => void
}) {
  const { expense, tripDestination, onRestored, onRestoreFailed } = options
  undoManager.registerAction({
    type: 'expense',
    data: expense,
    tripDestination,
  })

  const title = `Comprovante "${expense.merchant_name}" excluído`
  const desc = `${formatCurrencyBRL(expense.amount)} • Arquivo: ${expense.file_name}. Você pode desfazer esta ação.`

  sonnerToast.warning(title, {
    description: desc,
    duration: 10000,
    action: {
      label: 'Desfazer',
      onClick: async () => {
        try {
          const restored = await storageService.restoreExpense(expense)
          undoManager.clearLastAction()
          sonnerToast.success('Ação desfeita com sucesso!', {
            description: `O comprovante de ${restored.merchant_name} (${formatCurrencyBRL(restored.amount)}) foi restaurado.`,
            duration: 4000,
          })
          if (onRestored) {
            onRestored(restored)
          }
        } catch (err: any) {
          console.error('Falha ao restaurar despesa:', err)
          const msg = storageService.formatDatabaseError(err)
          sonnerToast.error('Não foi possível desfazer a exclusão', {
            description:
              msg.includes('bloqueada') || msg.includes('imutável') || msg.includes('fechada')
                ? 'A viagem de destino está bloqueada/fechada e não permite alterações contábeis.'
                : msg,
            duration: 6000,
          })
          if (onRestoreFailed) {
            onRestoreFailed(err)
          }
        }
      },
    },
  })
}

/**
 * Notifica exclusão de viagem com botão "Desfazer" interativo por 10 segundos.
 */
export function showTripDeletedUndoToast(options: {
  trip: Trip
  expenses: Expense[]
  onRestored?: (restored: Trip) => void
  onRestoreFailed?: (err: any) => void
}) {
  const { trip, expenses, onRestored, onRestoreFailed } = options
  undoManager.registerAction({
    type: 'trip',
    data: trip,
    expenses,
  })

  const title = `Viagem para "${trip.destination}" excluída`
  const desc = `${expenses.length} comprovante(s) e total de ${formatCurrencyBRL(trip.total_amount)}. Você pode desfazer esta ação.`

  sonnerToast.warning(title, {
    description: desc,
    duration: 10000,
    action: {
      label: 'Desfazer',
      onClick: async () => {
        try {
          const restored = await storageService.restoreTripWithExpenses(trip, expenses)
          undoManager.clearLastAction()
          sonnerToast.success('Viagem restaurada!', {
            description: `A viagem para "${restored.destination}" e seus ${expenses.length} comprovante(s) foram recuperados.`,
            duration: 5000,
          })
          if (onRestored) {
            onRestored(restored)
          }
        } catch (err: any) {
          console.error('Falha ao restaurar viagem:', err)
          sonnerToast.error('Não foi possível restaurar a viagem', {
            description: storageService.formatDatabaseError(err),
            duration: 6000,
          })
          if (onRestoreFailed) {
            onRestoreFailed(err)
          }
        }
      },
    },
  })
}

/**
 * Notifica alteração de status de ativação do usuário com botão "Desfazer" interativo.
 */
export function showUserStatusUndoToast(options: {
  user: Profile
  previousActiveState: boolean
  onReverted?: (revertedUser: Profile) => void
  onRevertFailed?: (err: any) => void
}) {
  const { user, previousActiveState, onReverted, onRevertFailed } = options
  const newActiveState = !previousActiveState

  undoManager.registerAction({
    type: 'user_deactivation',
    user,
    previousActiveState,
  })

  const actionVerb = newActiveState ? 'reativado' : 'desativado'
  const reverseVerb = previousActiveState ? 'reativar' : 'desativar'

  sonnerToast.info(`Colaborador ${user.full_name} ${actionVerb}`, {
    description: `Acesso à plataforma ${newActiveState ? 'liberado' : 'bloqueado'}. Deseja desfazer?`,
    duration: 10000,
    action: {
      label: 'Desfazer',
      onClick: async () => {
        try {
          await userService.updateUser(user.id, { is_active: previousActiveState })
          undoManager.clearLastAction()
          const updated: Profile = { ...user, is_active: previousActiveState }
          sonnerToast.success('Ação desfeita!', {
            description: `O colaborador ${user.full_name} foi ${previousActiveState ? 'reativado' : 'desativado'} novamente.`,
            duration: 4000,
          })
          if (onReverted) {
            onReverted(updated)
          }
        } catch (err: any) {
          sonnerToast.error(`Falha ao ${reverseVerb} usuário`, {
            description: err?.message || 'Erro inesperado ao reverter status.',
            duration: 6000,
          })
          if (onRestoreFailedSafe(onRevertFailed, err)) {
            // handled
          }
        }
      },
    },
  })
}

/**
 * Notifica exclusão de solicitação avulsa com botão "Desfazer" interativo por 10 segundos.
 */
export function showStandaloneRequestDeletedUndoToast(options: {
  request: StandaloneRequest
  onRestored?: (restored: StandaloneRequest) => void
  onRestoreFailed?: (err: any) => void
}) {
  const { request, onRestored, onRestoreFailed } = options
  undoManager.registerAction({
    type: 'standalone_request',
    data: request,
  })

  const title = `Solicitação "${request.description}" excluída`
  const desc = `${formatCurrencyBRL(request.amount)} • Categoria: ${request.category}. Você tem 10 segundos para desfazer.`

  sonnerToast.warning(title, {
    description: desc,
    duration: 10000,
    action: {
      label: 'Desfazer',
      onClick: async () => {
        try {
          const restored = await standaloneRequestService.restoreRequest(request)
          undoManager.clearLastAction()
          sonnerToast.success('Solicitação restaurada!', {
            description: `A solicitação "${restored.description}" foi recuperada com sucesso.`,
            duration: 5000,
          })
          if (onRestored) {
            onRestored(restored)
          }
        } catch (err: any) {
          console.error('Falha ao restaurar solicitação avulsa:', err)
          sonnerToast.error('Não foi possível restaurar a solicitação', {
            description: err?.message || 'Erro inesperado ao restaurar registro.',
            duration: 6000,
          })
          if (onRestoreFailed) {
            onRestoreFailed(err)
          }
        }
      },
    },
  })
}

function onRestoreFailedSafe(cb: ((err: any) => void) | undefined, err: any) {
  if (cb) {
    try {
      cb(err)
    } catch {
      // ignore
    }
    return true
  }
  return false
}
