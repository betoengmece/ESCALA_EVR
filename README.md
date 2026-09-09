# Escala EVR

Programa em HTML, CSS e JavaScript para gerenciar escalas de plantao.

## Funcionalidades

- Calendario mensal com cards arrastaveis.
- Regimes 24x72, 12x36, Comercial e Comercial Fixo.
- Preenchimento automatico e inteligente de plantoes.
- Restricoes por ferias, curso, feriado e outros impedimentos.
- Conferencia de inconsistencias de folga.
- Relatorios mensais e acumulados.
- Importacao de dados antigos e exportacao CSV.
- Salvamento e carregamento de backups.
- Historico para desfazer movimentos.

## Como usar

Abra o arquivo `index.html` no navegador.

Os dados do uso normal ficam salvos no armazenamento local do navegador. Para preservar historico entre computadores ou navegadores, use as opcoes de salvar/carregar backup do proprio programa.

## Ferias da equipe

O acesso `ferias.html` permite selecionar um nome, cadastrar, editar e excluir somente ferias dessa pessoa, e consultar o calendario coletivo de ferias. O calendario mostra a quantidade de pessoas ausentes, sem impor limite simultaneo. A escala continua em `index.html`.

As regras configuradas sao: ate 30 dias por competencia, ate tres periodos, sem numero de periodo repetido ou sobreposicao com impedimentos da mesma pessoa. Ao cadastrar o terceiro periodo, o total precisa completar 30 dias. O primeiro periodo comeca entre segunda e quinta-feira; os demais nao possuem esse bloqueio. Estas sao as regras operacionais definidas para este aplicativo.

### Ativacao

1. No aparelho com os dados corretos, salve um backup.
2. Substitua o codigo do Apps Script pelo conteudo completo de `google-apps-script.js`.
3. Em Gerenciar implantacoes, edite a implantacao existente, selecione Nova versao e implante. Mantenha a URL atual e o acesso do aplicativo web configurado para qualquer pessoa.
4. Atualize a pagina administrativa. Ela consultara as restricoes ja existentes na nuvem. O envio passa a gravar somente escala e equipe; cadastre eventuais impedimentos ainda nao enviados em `ferias.html?admin=1`.
5. Distribua `https://betoengmece.github.io/ESCALA_EVR/ferias.html`.

O botao Salvar minhas ferias grava apenas um registro, sem mudar a escala. O servidor serializa gravacoes com bloqueio e compara a revisao do registro antes de editar ou excluir. Em conflito, a edicao permanece no formulario; Atualizar consulta os dados mais recentes antes de uma nova edicao.

O aplicativo principal envia somente escala, equipe e configuracoes dos regimes. O servidor ignora restricoes e feriados recebidos nesse envio, inclusive de clientes antigos e em envios forcados. Essas tabelas nao sao regravadas. O aplicativo consulta as restricoes da nuvem ao abrir, ao recuperar o foco e antes de preencher, validar ou enviar. Os cards existentes sao preservados e os conflitos aparecem na conferencia e no aviso da nuvem.

O botao Restricoes abre `ferias.html?admin=1`. Com a senha administrativa, essa pagina permite cadastrar, editar e excluir ferias, cursos, atestados, outros impedimentos e feriados, um registro por vez. Ha filtros por pessoa, tipo, vigentes/futuras, todas e mes do calendario. As regras de ferias geram uma confirmacao explicita para excecoes administrativas; a equipe continua sujeita aos bloqueios. A senha e a revisao do registro sao conferidas no servidor.

As restricoes existentes na nuvem permanecem intactas na atualizacao. Eventuais restricoes que existam somente em um backup local devem ser cadastradas na pagina administrativa: o envio da escala e a restauracao de um backup de escala nao publicam restricoes. O cache consultado da nuvem tambem e preservado ao desfazer movimentos e importar backups no aplicativo principal.

A selecao por nome funciona por confianca: nao comprova identidade e permite selecionar outro nome. A senha simples administrativa permanece no codigo do aplicativo; nao constitui autenticacao forte. A equipe nao recebe controles de edicao da escala nessa pagina.

### Verificacao

`node --test tests/team-sync.test.cjs` verifica regras, conflitos, isolamento de registros e a separacao do envio da escala sem acessar dados reais. `tests/team-ui.cjs` usa Playwright e Chrome, com respostas ficticias da nuvem, para verificar as telas da equipe e da administracao em computador e celular, e a abertura do aplicativo principal.
