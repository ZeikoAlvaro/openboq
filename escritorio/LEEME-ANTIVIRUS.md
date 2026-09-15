# OpenBOQ escritorio — por qué protesta el antivirus, y qué se puede hacer

Este archivo existe porque la pregunta se repite y la respuesta corta
—«firmá el ejecutable»— no explica nada.

---

## 1. Qué está pasando

Avast bloquea a OpenBOQ con **`IDP.Generic`**. Defender y SmartScreen dicen
otra cosa pero es el mismo mecanismo. Ninguno encontró un virus: encontraron
un programa que **no puede probar quién lo hizo**, y lo juzgaron por lo que
hace.

Lo que hace OpenBOQ, visto desde afuera por un antivirus:

| Lo que ve el antivirus | Lo que es en realidad |
|---|---|
| Un `.exe` sin firma digital | Un proyecto sin certificado de firma |
| Que escribe archivos en `%APPDATA%` | `ajustes.json` — la última carpeta usada |
| Que abre un servidor en un puerto | El servidor interno en `127.0.0.1:8731` |
| Que descarga y reemplaza ejecutables | `electron-updater` |
| Un binario que nunca vio antes | Recién armado, cero instalaciones previas |

Cada punto por separado es inocente. Los cinco juntos, en un ejecutable
anónimo, es exactamente el perfil de la heurística. **No hay bandera que
apagar, ni línea de código que sacar, ni configuración de
`electron-builder` que evite esto.** El problema no es lo que el programa
hace: es que no hay nadie firmando debajo.

> **Efecto secundario que ya costó tiempo**: cuando Avast bloquea una ruta,
> la deja vedada *incluso para el usuario*. Por eso el archivo de
> preferencias se llama `ajustes.json` y no `preferencias.json`, y por eso la
> última carpeta usada se recuerda **también en memoria** y no solo en disco:
> con la ruta bloqueada, la sesión en curso funciona igual.

---

## 2. Los tres caminos, del definitivo al de parche

### A. Firmar el ejecutable — la única cura de raíz

Un `.exe` firmado con un certificado reconocido deja de ser anónimo. Avast y
Defender bajan la heurística, y SmartScreen empieza a acumular reputación
en vez de bloquear en seco.

**Ojo con una trampa de la industria**: desde junio de 2023 las autoridades
certificadoras ya **no venden certificados en archivo `.pfx`**. La clave
privada tiene que vivir en un token físico o en un HSM en la nube. Cualquier
guía anterior a esa fecha que hable de «comprás el `.pfx` y listo» está
vencida.

Opciones reales, de menor a mayor costo (precios aproximados, verificar
antes de comprar):

| Camino | Costo | Requisitos | Notas |
|---|---|---|---|
| **SignPath Foundation** | gratis | proyecto de código abierto elegible, repositorio público, armado en CI | OpenBOQ es MIT: califica. Exige mover el armado a un CI (GitHub Actions o similar) |
| **Certum Open Source** | ~90 € el primer año | autor de código abierto, verificación de identidad | Certificado en tarjeta o en la nube (SimplySign) |
| **Azure Trusted Signing** | ~10 US$/mes | entidad verificada, o persona en los países habilitados | Firma en la nube, sin token físico |
| **OV clásico (Sectigo, DigiCert…)** | 200–400 US$/año | verificación de organización + token USB | El token hay que tenerlo puesto para armar |
| **EV** | 400+ US$/año | verificación reforzada + token | Único que da reputación de SmartScreen **desde la primera descarga** |

**Cómo firmar con este proyecto, una vez que haya certificado:**

```powershell
$env:CSC_LINK = "C:\ruta\al\certificado.pfx"   # o su contenido en base64
$env:CSC_KEY_PASSWORD = "la contraseña"
npm run armar
```

`hacer.js` avisa al empezar si va a firmar o no:

```
   firma:           sí (CSC_LINK)
   firma:           NO — el antivirus va a protestar
```

Para los certificados en la nube (Azure Trusted Signing, SimplySign) no
alcanza con `CSC_LINK`: hay que enganchar un `sign` propio en la
configuración de `electron-builder`, o pasar a `electron-builder` 25 o más
nuevo, que trae `azureSignOptions`. Este proyecto está en la 24.13.3.

**Firmar no borra el problema el primer día.** SmartScreen sigue mostrando
«editor desconocido» hasta juntar descargas, salvo con un certificado EV.
Lo que sí desaparece de entrada es el bloqueo por heurística de Avast.

---

### B. Excluir OpenBOQ en la máquina que lo usa — el parche que funciona hoy

Es lo que hay hasta que exista certificado. Hay que hacerlo **una vez por
máquina**, y conviene excluir la carpeta entera, no el `.exe` suelto: el
actualizador reemplaza el ejecutable y la exclusión de un archivo se pierde.

Carpetas a excluir (instalación por usuario, sin administrador):

```
%LOCALAPPDATA%\Programs\OpenBOQ
%APPDATA%\OpenBOQ
```

**Windows Defender** — en PowerShell *como administrador*:

```powershell
Add-MpPreference -ExclusionPath "$env:LOCALAPPDATA\Programs\OpenBOQ"
Add-MpPreference -ExclusionPath "$env:APPDATA\OpenBOQ"
```

Para ver lo que quedó excluido:

```powershell
(Get-MpPreference).ExclusionPath
```

**Avast** — no tiene línea de comandos para esto; va a mano:

1. Menú → **Configuración** → **General** → **Excepciones**.
2. **Agregar excepción** → pegar las dos rutas de arriba.
3. En **Protección** → **Core Shields** → **Escudo de comportamiento**,
   agregar la misma carpeta si el bloqueo vuelve (es el escudo que dispara
   `IDP.Generic`).

Si Avast ya movió el archivo a la Cuarentena, hay que **restaurarlo desde
ahí** además de agregar la excepción: mientras esté en cuarentena, la ruta
sigue vedada.

> Mientras el aviso de Avast está en pantalla es una ventana elevada y
> siempre encima: ningún clic ni tecla sintética llega a ninguna otra
> aplicación. Si algo automatizado dejó de responder, mirar primero si hay un
> aviso de Avast esperando.

---

### C. Reportar el falso positivo — gratis, lento, y no siempre dura

Los dos aceptan reportes de archivos limpios marcados por error:

- **Avast**: formulario de falso positivo en su sitio de soporte, adjuntando
  el `.exe`.
- **Microsoft**: portal de análisis de Microsoft Defender, opción «envío de
  desarrollador de software».

Suelen contestar en días. El problema es que **la excepción vale para ese
archivo exacto**: la próxima versión es otro binario y hay que reportarla de
nuevo. Sirve como acompañamiento, no como solución.

---

## 3. `SHA256.txt`

Cada armado deja un `SHA256.txt` junto a los instaladores, con la huella de
cada `.exe`. Para verificar una copia descargada:

```powershell
Get-FileHash .\OpenBOQ-2.2.0-x64-instalador.exe -Algorithm SHA256
```

El resultado tiene que coincidir con la línea del archivo. No reemplaza a la
firma —quien pueda alterar el `.exe` en el servidor también puede alterar el
`SHA256.txt`—, pero resuelve el caso que pasa de verdad: saber si lo que hay
en el escritorio es lo que salió del armado, o una descarga que el antivirus
cortó por la mitad.

---

## 4. Resumen para decidir

- **Uso interno, pocas máquinas conocidas** → camino B. Se excluye la carpeta
  y se sigue trabajando. Costo cero.
- **Reparto abierto, gente que no se conoce** → camino A, sin vueltas. Pedir
  a cada persona que desactive su antivirus no es viable ni honesto.
- **Repositorio público** → probar SignPath Foundation antes de pagar nada:
  es gratis para código abierto y resuelve el mismo problema que un
  certificado comprado.
