import React, { useState } from 'react'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { TransportType, Trip } from '@/types/database'
import { storageService } from '@/services/storageService'
import { useToast } from '@/hooks/use-toast'
import { useAuth } from '@/hooks/use-auth'
import { Plane, Car, CarFront, MoreHorizontal, Calendar, MapPin, Briefcase } from 'lucide-react'

interface CreateTripModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onCreated: (trip: Trip) => void
}

export function CreateTripModal({ open, onOpenChange, onCreated }: CreateTripModalProps) {
  const { toast } = useToast()
  const { user } = useAuth()
  const [loading, setLoading] = useState(false)
  const [destination, setDestination] = useState('')
  const [startDate, setStartDate] = useState('')
  const [endDate, setEndDate] = useState('')
  const [transportType, setTransportType] = useState<TransportType>('aéreo')
  const [motivo, setMotivo] = useState('')
  const [notes, setNotes] = useState('')

  const resetForm = () => {
    setDestination('')
    setStartDate('')
    setEndDate('')
    setTransportType('aéreo')
    setMotivo('')
    setNotes('')
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!destination.trim()) {
      toast({
        title: 'Destino obrigatório',
        description: 'Por favor, informe a cidade ou destino da viagem corporativa.',
        variant: 'destructive',
      })
      return
    }

    if (!startDate || !endDate) {
      toast({
        title: 'Período obrigatório',
        description: 'Informe as datas de início e término.',
        variant: 'destructive',
      })
      return
    }

    if (new Date(startDate) > new Date(endDate)) {
      toast({
        title: 'Datas inválidas',
        description: 'A data de início não pode ser posterior à data de término.',
        variant: 'destructive',
      })
      return
    }

    setLoading(true)
    try {
      const newTrip = await storageService.createTrip({
        user_id: user?.id,
        destination: destination.trim(),
        start_date: startDate,
        end_date: endDate,
        transport_type: transportType,
        status: 'em_triagem',
        motivo: motivo.trim() || 'Deslocamento corporativo a negócios',
        notes: notes.trim(),
      })

      toast({
        title: 'Viagem criada com sucesso!',
        description: `Viagem para ${newTrip.destination} foi cadastrada e está pronta para vincular recibos.`,
      })
      resetForm()
      onOpenChange(false)
      onCreated(newTrip)
    } catch {
      toast({
        title: 'Erro ao criar viagem',
        description: 'Não foi possível salvar o registro.',
        variant: 'destructive',
      })
    } finally {
      setLoading(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[540px] max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="text-xl font-bold flex items-center gap-2 text-slate-900">
            <div className="w-8 h-8 rounded-lg bg-blue-100 text-blue-800 flex items-center justify-center">
              <Briefcase className="w-4 h-4" />
            </div>
            Nova Viagem Corporativa
          </DialogTitle>
          <DialogDescription className="text-sm text-slate-500">
            Cadastre os dados base do deslocamento para vincular comprovantes e iniciar a auditoria.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4 pt-2">
          {/* Destino */}
          <div className="space-y-1.5">
            <Label
              htmlFor="destination"
              className="text-xs font-semibold text-slate-700 flex items-center gap-1.5"
            >
              <MapPin className="w-3.5 h-3.5 text-blue-600" />
              Destino (Cidade, UF) *
            </Label>
            <Input
              id="destination"
              placeholder="Ex: Rio de Janeiro, RJ"
              value={destination}
              onChange={(e) => setDestination(e.target.value)}
              required
              className="text-sm"
            />
          </div>

          {/* Período */}
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label
                htmlFor="start_date"
                className="text-xs font-semibold text-slate-700 flex items-center gap-1.5"
              >
                <Calendar className="w-3.5 h-3.5 text-slate-500" />
                Data de Início *
              </Label>
              <Input
                id="start_date"
                type="date"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
                required
                className="text-sm"
              />
            </div>
            <div className="space-y-1.5">
              <Label
                htmlFor="end_date"
                className="text-xs font-semibold text-slate-700 flex items-center gap-1.5"
              >
                <Calendar className="w-3.5 h-3.5 text-slate-500" />
                Data de Término *
              </Label>
              <Input
                id="end_date"
                type="date"
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
                required
                className="text-sm"
              />
            </div>
          </div>

          {/* Transporte Principal */}
          <div className="space-y-1.5">
            <Label className="text-xs font-semibold text-slate-700">Transporte Principal</Label>
            <Select
              value={transportType}
              onValueChange={(val) => setTransportType(val as TransportType)}
            >
              <SelectTrigger className="text-sm">
                <SelectValue placeholder="Selecione o meio de transporte" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="aéreo">
                  <div className="flex items-center gap-2">
                    <Plane className="w-4 h-4 text-blue-600" />
                    <span>Aéreo (Companhias de Aviação)</span>
                  </div>
                </SelectItem>
                <SelectItem value="carro_alugado">
                  <div className="flex items-center gap-2">
                    <CarFront className="w-4 h-4 text-emerald-600" />
                    <span>Carro Alugado (Locadora)</span>
                  </div>
                </SelectItem>
                <SelectItem value="carro_proprio">
                  <div className="flex items-center gap-2">
                    <Car className="w-4 h-4 text-amber-600" />
                    <span>Carro Próprio (Reembolso KM / Combustível)</span>
                  </div>
                </SelectItem>
                <SelectItem value="outros">
                  <div className="flex items-center gap-2">
                    <MoreHorizontal className="w-4 h-4 text-slate-600" />
                    <span>Outros (Ônibus, Trem, Transfer)</span>
                  </div>
                </SelectItem>
              </SelectContent>
            </Select>
          </div>

          {/* Motivo da Viagem */}
          <div className="space-y-1.5">
            <Label htmlFor="motivo" className="text-xs font-semibold text-slate-700">
              Motivo / Justificativa Corporativa *
            </Label>
            <Textarea
              id="motivo"
              rows={2}
              placeholder="Ex: Reunião com diretoria comercial, workshop de tecnologia ou visita técnica."
              value={motivo}
              onChange={(e) => setMotivo(e.target.value)}
              required
              className="text-sm resize-none"
            />
          </div>

          {/* Notas Adicionais */}
          <div className="space-y-1.5">
            <Label htmlFor="notes" className="text-xs font-semibold text-slate-700">
              Observações / Políticas Aplicadas (opcional)
            </Label>
            <Textarea
              id="notes"
              rows={2}
              placeholder="Informações sobre adiantamentos, centro de custo ou número do projeto."
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              className="text-sm resize-none"
            />
          </div>

          <DialogFooter className="pt-3 gap-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={loading}
            >
              Cancelar
            </Button>
            <Button
              type="submit"
              disabled={loading}
              className="bg-[#1e40af] hover:bg-[#1d3d9e] text-white"
            >
              {loading ? 'Salvando...' : 'Criar Viagem'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
