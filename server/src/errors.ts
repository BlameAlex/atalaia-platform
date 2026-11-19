import { HttpException } from '@nestjs/common';

const MESSAGES: Record<string, string> = {
  unauthorized: 'Sesión no válida. Vuelve a iniciar sesión.',
  otp_invalid: 'Código incorrecto o vencido.',
  no_user: 'Completa tu perfil primero.',
  not_found: 'No existe.',
  already_registered: 'Este teléfono ya tiene un perfil.',
  plan_changed: 'El plan cambió. Revísalo de nuevo.',
  not_deployable: 'Esta ruta no se puede desplegar ahora.',
  status_conflict: 'El estado cambió. Actualiza la vista.',
  address_not_found: 'Revisa la dirección.',
  otp_cooldown: 'Espera unos segundos antes de pedir otro código.',
  otp_locked: 'Demasiados intentos. Pide un código nuevo.',
  geocoder_unavailable: 'Servicio de direcciones no disponible. Intenta más tarde.',
  demo_pool_busy: 'Todos los usuarios simulados ya tienen un SOS abierto.',
  demo_pool_missing: 'Faltan los usuarios simulados: corre tools/simulate-sos.mjs una vez.',
  risk_unavailable: 'Servicio de riesgo no disponible. Intenta más tarde.',
};

const camel = (s: string) => s.replace(/_(\w)/g, (_, c: string) => c.toUpperCase());

/** Throws the S13 error body {error, message (Spanish), field?, ...extra}. */
export function fail(status: number, code: string, extra: Record<string, unknown> = {}): never {
  let field: string | undefined;
  let message = MESSAGES[code];
  if (code.startsWith('invalid_')) {
    field = camel(code.slice(8));
    message = `Dato no válido: ${field}.`;
  }
  throw new HttpException({ error: code, message: message ?? code, ...(field ? { field } : {}), ...extra }, status);
}

export const invalid = (field: string): never => fail(400, 'invalid_' + field.replace(/[A-Z]/g, (c) => '_' + c.toLowerCase()));

import { ArgumentsHost, Catch, ExceptionFilter } from '@nestjs/common';

export const uuid = (id: string): string => (/^[0-9a-f-]{36}$/i.test(id) ? id : fail(404, 'not_found'));

/** Every error leaves as {error, message, field?} (S13), including framework-raised ones. */
@Catch()
export class ErrorFilter implements ExceptionFilter {
  catch(e: unknown, host: ArgumentsHost) {
    const res = host.switchToHttp().getResponse();
    if (e instanceof HttpException) {
      const body: any = e.getResponse();
      if (body && typeof body === 'object' && typeof body.error === 'string') return res.status(e.getStatus()).json(body);
      if (e.getStatus() === 404) return res.status(404).json({ error: 'not_found', message: MESSAGES.not_found });
      if (e.getStatus() < 500) return res.status(e.getStatus()).json({ error: 'invalid_body', message: 'Cuerpo no válido.' });
    }
    console.error(e);
    res.status(500).json({ error: 'internal_error', message: 'Error interno.' });
  }
}
