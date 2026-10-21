# Acceso SSH desde el PC de Juan

El propietario autorizo el 22 de octubre de 2026 configurar el alias `suleia`
en la cuenta Windows `juan` del otro PC, utilizando su propia clave.
La clave publica fue facilitada directamente por el propietario en el chat.

- Destino: `suleiaops@169.58.77.219`, puerto 22.
- Identidad local: `%USERPROFILE%\.ssh\suleia_juan_ed25519`.
- Huella autorizada: `SHA256:NdcrZ16r/sGEsmIPWNlAxMydEmH5VYkvKQEeraBeu+Q`.
- La clave privada debe permanecer en el perfil local de Juan, fuera del
  repositorio y de OneDrive. No copiar la clave privada de otro administrador.

El servidor ya contiene esta clave publica una sola vez. Se conservaron
integramente las entradas anteriores y los permisos `0700`/`0600`.
Esto autoriza la autenticacion como el usuario de operaciones existente;
no cambia permisos de sudo, SSH daemon, aplicaciones ni autorizaciones de negocio.

## Completar en el PC correcto

Abrir PowerShell en la sesion Windows `juan`, con OpenSSH instalado y con
la pareja de claves que corresponde a la huella anterior. Ejecutar desde
este checkout:

```powershell
& .\scripts\configure-suleia-ssh-juan.ps1
```

El script rechaza otras cuentas, claves publicas diferentes y enlaces.
Conserva la configuracion previa en una copia local, coloca el alias antes
de las reglas anteriores y utiliza un archivo de host conocido independiente.
El pin publico del servidor se obtuvo mediante la conexion SSH estricta ya
verificada del administrador; no se acepta a ciegas un host nuevo.
No genera ni reemplaza claves y nunca solicita compartir una passphrase.
Si la clave esta cifrada, OpenSSH puede pedir la passphrase localmente.

La ultima comprobacion ejecuta **desde Juan**:

```powershell
ssh suleia whoami
```

El script comprueba tambien que el servidor acepta la huella propia de Juan,
con un registro diagnostico local temporal que elimina al terminar.
El resultado debe ser `suleiaops`, con codigo de salida 0. Hasta obtener
esa prueba no se debe declarar verificado el acceso desde su PC. Una prueba
hecha con la clave del otro administrador no sustituye esta comprobacion.
Despues, el comando habitual de conexion es:

```powershell
ssh suleia
```

## Revocacion

Desde otro acceso administrativo que siga funcionando, retirar unicamente
la entrada cuya huella es `SHA256:NdcrZ16r/sGEsmIPWNlAxMydEmH5VYkvKQEeraBeu+Q`
de `/home/suleiaops/.ssh/authorized_keys`; conservar las demas entradas y
los permisos. Registrar la revocacion y comprobar una conexion independiente.
No restaurar un archivo antiguo completo: podria eliminar altas posteriores.
