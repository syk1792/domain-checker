// 'whois' 라이브러리를 사용하여 도메인 정보를 조회합니다.
const whois = require('whois');
const util = require('util');

// whois.lookup 함수는 콜백 기반이므로, async/await와 함께 사용하기 위해 프로미스(Promise)로 변환합니다.
const lookup = util.promisify(whois.lookup);

/**
 * WHOIS가 반환하는 원본 텍스트 데이터에서 필요한 정보(만료일, 등록일, 등록기관)를 추출하는 함수입니다.
 * @param {string} rawData - WHOIS 조회로 얻은 원본 텍스트 데이터
 * @returns {{expiry_date: string|null, creation_date: string|null, registrar: string|null}} - 추출된 정보 객체
 */
function parseWhoisData(rawData) {
    const lines = rawData.split('\n');
    let expiryDate = null;
    let creationDate = null;
    let registrar = null;

    // 등록기관마다 사용하는 키워드가 다르기 때문에 여러 키워드를 배열로 관리합니다.
    const expiryKeywords = ['Registry Expiry Date:', 'Registrar Registration Expiration Date:', 'Expiry Date:', 'expires:', 'Expiration Time:'];
    const creationKeywords = ['Creation Date:', 'Registration Date:', 'Registered on:', 'created:'];
    const registrarKeywords = ['Registrar:', 'Registrar Name:', 'Sponsoring Registrar:'];

    // 텍스트를 한 줄씩 읽으면서 필요한 정보가 있는지 확인합니다.
    for (const line of lines) {
        const trimmedLine = line.trim();

        // 만료일 정보 찾기
        if (!expiryDate) {
            for (const keyword of expiryKeywords) {
                if (trimmedLine.toLowerCase().startsWith(keyword.toLowerCase())) {
                    expiryDate = trimmedLine.substring(keyword.length).trim();
                    break;
                }
            }
        }

        // 등록일 정보 찾기
        if (!creationDate) {
            for (const keyword of creationKeywords) {
                if (trimmedLine.toLowerCase().startsWith(keyword.toLowerCase())) {
                    creationDate = trimmedLine.substring(keyword.length).trim();
                    break;
                }
            }
        }

        // 등록기관 정보 찾기
        if (!registrar) {
            for (const keyword of registrarKeywords) {
                if (trimmedLine.toLowerCase().startsWith(keyword.toLowerCase())) {
                    registrar = trimmedLine.substring(keyword.length).trim();
                    break;
                }
            }
        }
    }

    return {
        expiry_date: expiryDate,
        creation_date: creationDate,
        registrar: registrar,
    };
}

// Netlify 서버리스 함수의 메인 핸들러
exports.handler = async (event) => {
    // CORS 문제를 방지하기 위한 헤더 설정
    const headers = {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Content-Type',
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
        'Content-Type': 'application/json'
    };

    // OPTIONS 메소드 요청(preflight)에 대한 처리
    if (event.httpMethod === 'OPTIONS') {
        return { statusCode: 200, headers, body: '' };
    }

    const domain = event.queryStringParameters?.domain;

    if (!domain) {
        return {
            statusCode: 400,
            headers,
            body: JSON.stringify({ error: '도메인 파라미터가 필요합니다.' })
        };
    }

    try {
        // whois.lookup을 호출하여 도메인 정보를 비동기적으로 조회합니다.
        const rawData = await lookup(domain);
        if (!rawData) {
            throw new Error('도메인 정보를 찾을 수 없습니다. (존재하지 않는 도메인일 수 있습니다)');
        }

        // 조회한 원본 데이터에서 필요한 정보를 파싱합니다.
        const parsedData = parseWhoisData(rawData);

        // 만료일 정보가 없으면 에러로 처리합니다. (.kr 등 일부 도메인은 조회가 제한될 수 있습니다)
        if (!parsedData.expiry_date) {
             throw new Error('도메인 만료일 정보를 파싱할 수 없습니다. 지원되지 않는 도메인 형식이거나 정보 조회가 제한된 도메인일 수 있습니다.');
        }

        // 성공적으로 조회 및 파싱된 정보를 프론트엔드로 반환합니다.
        return {
            statusCode: 200,
            headers,
            body: JSON.stringify({
                domain: domain,
                ...parsedData,
                status: 'registered'
            })
        };

    } catch (error) {
        console.error('WHOIS Lookup Error:', error);
        
        // 에러 메시지를 좀 더 사용자 친화적으로 변경합니다.
        let errorMessage = '도메인 정보를 조회하는 중 오류가 발생했습니다.';
        if (error.message && (error.message.includes('No match for domain') || error.message.includes('Domain not found'))) {
            errorMessage = '해당 도메인을 찾을 수 없습니다. 오타가 없는지 확인해주세요.';
        } else if (error.message) {
            errorMessage = error.message;
        }

        return {
            statusCode: 500,
            headers,
            body: JSON.stringify({ error: errorMessage })
        };
    }
};
