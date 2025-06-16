const puppeteer = require('puppeteer');
const fs = require('fs').promises;
const path = require('path');

class MusinsaEmailCollector {
    constructor() {
        this.browser = null;
        this.page = null;
        this.results = [];
        this.failedBrands = [];
        this.delay = 3000; // 기본 지연시간 3초
    }

    // 지연 함수 (waitForTimeout 대체)
    async delay(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    async init() {
        console.log('브라우저 초기화 중...');
        this.browser = await puppeteer.launch({
            headless: false, // 디버깅을 위해 브라우저 창 표시
            args: [
                '--no-sandbox',
                '--disable-setuid-sandbox',
                '--disable-blink-features=AutomationControlled',
                '--disable-features=VizDisplayCompositor',
                '--disable-web-security',
                '--disable-features=VizDisplayCompositor'
            ]
        });
        
        this.page = await this.browser.newPage();
        
        // User Agent 설정 (봇 감지 방지)
        await this.page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
        
        // 타임아웃 설정
        this.page.setDefaultTimeout(30000);
        this.page.setDefaultNavigationTimeout(30000);
        
        // 추가 헤더 설정
        await this.page.setExtraHTTPHeaders({
            'Accept-Language': 'ko-KR,ko;q=0.9,en;q=0.8'
        });
        
        console.log('브라우저 초기화 완료');
    }

    // 브랜드명을 URL 인코딩
    encodeKoreanBrand(brandName) {
        return encodeURIComponent(brandName);
    }

    // 무신사에서 브랜드 검색하고 첫 번째 상품 URL 반환
    async searchBrand(brandName) {
        try {
            const encodedBrand = this.encodeKoreanBrand(brandName);
            const searchUrl = `https://www.musinsa.com/search/goods?keyword=${encodedBrand}&gf=A`;
            
            console.log(`  🔍 브랜드 검색: ${brandName}`);
            await this.page.goto(searchUrl, { waitUntil: 'networkidle2' });
            
            // 검색 결과 로딩 대기
            await this.delay(2000);
            
            // 첫 번째 상품 링크 찾기
            const firstProductLink = await this.page.evaluate(() => {
                const productLink = document.querySelector('a[href*="/products/"]');
                return productLink ? productLink.href : null;
            });
            
            if (!firstProductLink) {
                throw new Error('검색 결과에서 상품을 찾을 수 없습니다');
            }
            
            console.log(`  ✅ 상품 발견: ${firstProductLink}`);
            return firstProductLink;
            
        } catch (error) {
            console.log(`  ❌ 검색 실패: ${error.message}`);
            return null;
        }
    }

    // 상품 페이지에서 판매자 정보 추출
    async extractSellerInfo(productUrl) {
        try {
            console.log(`  📄 상품 페이지 접속`);
            await this.page.goto(productUrl, { waitUntil: 'networkidle2' });
            
            // 페이지 로딩 대기
            await this.delay(3000);
            
            // 판매자 정보 버튼 찾기 및 클릭
            console.log(`  🔘 판매자 정보 버튼 클릭 시도`);
            
            const buttonClicked = await this.page.evaluate(() => {
                // 여러 가지 방법으로 판매자 정보 버튼 찾기
                const buttons = document.querySelectorAll('button');
                for (const button of buttons) {
                    const buttonText = button.textContent || button.innerText || '';
                    if (buttonText.includes('판매자 정보') || buttonText.includes('판매자정보')) {
                        try {
                            button.click();
                            return true;
                        } catch (e) {
                            console.log('버튼 클릭 실패:', e.message);
                        }
                    }
                }
                
                // 대안적인 셀렉터들 시도
                const alternativeSelectors = [
                    '[data-mds="AccordionTrigger"]',
                    'button[aria-controls*="radix"]',
                    'button[class*="AccordionTrigger"]',
                    'button[class*="accordion"]'
                ];
                
                for (const selector of alternativeSelectors) {
                    try {
                        const elements = document.querySelectorAll(selector);
                        for (const element of elements) {
                            const text = element.textContent || element.innerText || '';
                            if (text.includes('판매자')) {
                                element.click();
                                return true;
                            }
                        }
                    } catch (e) {
                        continue;
                    }
                }
                
                return false;
            });
            
            if (!buttonClicked) {
                throw new Error('판매자 정보 버튼을 찾거나 클릭할 수 없습니다');
            }
            
            // 판매자 정보 패널 로딩 대기
            await this.delay(3000);
            
            // 이메일 정보 추출
            console.log(`  📧 이메일 정보 추출 중`);
            const sellerInfo = await this.page.evaluate(() => {
                const findInfoByLabel = (label) => {
                    // dt 태그에서 라벨 찾기
                    const dts = document.querySelectorAll('dt');
                    for (const dt of dts) {
                        const dtText = dt.textContent || dt.innerText || '';
                        if (dtText.trim().includes(label)) {
                            const dd = dt.nextElementSibling;
                            if (dd && dd.tagName === 'DD') {
                                return (dd.textContent || dd.innerText || '').trim();
                            }
                        }
                    }
                    
                    // 대안적인 방법: 모든 텍스트에서 이메일 패턴 찾기
                    if (label === 'E-mail' || label === '이메일') {
                        const allText = document.body.textContent || document.body.innerText || '';
                        const emailRegex = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;
                        const emails = allText.match(emailRegex);
                        if (emails && emails.length > 0) {
                            // 일반적이지 않은 이메일 도메인 필터링
                            const validEmails = emails.filter(email => 
                                !email.includes('noreply') && 
                                !email.includes('example') &&
                                !email.includes('test')
                            );
                            return validEmails[0] || null;
                        }
                    }
                    
                    return null;
                };
                
                return {
                    email: findInfoByLabel('E-mail') || findInfoByLabel('이메일'),
                    brand: findInfoByLabel('브랜드'),
                    company: findInfoByLabel('상호') || findInfoByLabel('대표자'),
                    phone: findInfoByLabel('연락처'),
                    businessNumber: findInfoByLabel('사업자번호'),
                    address: findInfoByLabel('영업소재지') || findInfoByLabel('주소')
                };
            });
            
            console.log(`  📋 추출 완료:`, sellerInfo);
            return sellerInfo;
            
        } catch (error) {
            console.log(`  ❌ 정보 추출 실패: ${error.message}`);
            return null;
        }
    }

    // 단일 브랜드 처리
    async processBrand(brand, index, total) {
        const startTime = Date.now();
        
        try {
            console.log(`\n[${index + 1}/${total}] === ${brand.brandName} (${brand.brandNameEnglish || 'N/A'}) ===`);
            
            // 한글 브랜드명으로 먼저 검색
            let productUrl = await this.searchBrand(brand.brandName);
            
            // 실패시 영어 브랜드명으로 재시도
            if (!productUrl && brand.brandNameEnglish) {
                console.log(`  🔄 영어명으로 재시도: ${brand.brandNameEnglish}`);
                productUrl = await this.searchBrand(brand.brandNameEnglish);
            }
            
            if (!productUrl) {
                throw new Error('상품을 찾을 수 없습니다');
            }
            
            // 판매자 정보 추출
            const sellerInfo = await this.extractSellerInfo(productUrl);
            
            if (!sellerInfo || !sellerInfo.email) {
                throw new Error('이메일 정보를 찾을 수 없습니다');
            }
            
            // 성공 결과 저장
            const result = {
                ...brand,
                musinsaEmail: sellerInfo.email,
                musinsaSellerInfo: sellerInfo,
                musinsaProductUrl: productUrl,
                status: 'success',
                collectedAt: new Date().toISOString(),
                processingTime: `${Date.now() - startTime}ms`
            };
            
            this.results.push(result);
            console.log(`  ✅ 성공: ${sellerInfo.email} (${Date.now() - startTime}ms)`);
            
            return result;
            
        } catch (error) {
            console.log(`  ❌ 실패: ${error.message} (${Date.now() - startTime}ms)`);
            
            const failedResult = {
                ...brand,
                status: 'failed',
                error: error.message,
                collectedAt: new Date().toISOString(),
                processingTime: `${Date.now() - startTime}ms`
            };
            
            this.failedBrands.push(failedResult);
            return null;
        }
    }

    // 여러 브랜드 일괄 처리
    async processBrands(brands, options = {}) {
        const { delay = this.delay, batchSize = 10, maxRetries = 2 } = options;
        
        console.log(`\n🚀 총 ${brands.length}개 브랜드 처리 시작`);
        console.log(`⚙️ 설정: 지연시간 ${delay}ms, 배치크기 ${batchSize}`);
        
        for (let i = 0; i < brands.length; i++) {
            const brand = brands[i];
            
            await this.processBrand(brand, i, brands.length);
            
            // 마지막 브랜드가 아닌 경우 지연
            if (i < brands.length - 1) {
                console.log(`  ⏳ ${delay}ms 대기...`);
                await this.delay(delay);
            }
            
            // 배치마다 중간 저장 및 휴식
            if ((i + 1) % batchSize === 0 && i < brands.length - 1) {
                console.log(`\n💾 중간 저장 및 30초 휴식 (${i + 1}/${brands.length} 완료)`);
                await this.saveIntermediateResults();
                await this.delay(30000);
            }
        }
        
        console.log('\n🎉 === 처리 완료 ===');
        console.log(`✅ 성공: ${this.results.length}개`);
        console.log(`❌ 실패: ${this.failedBrands.length}개`);
        console.log(`📊 성공률: ${((this.results.length / brands.length) * 100).toFixed(1)}%`);
    }

    // 중간 결과 저장
    async saveIntermediateResults() {
        const timestamp = Date.now();
        const tempFile = `musinsa_temp_${timestamp}.json`;
        
        const tempData = {
            timestamp: new Date().toISOString(),
            processedCount: this.results.length + this.failedBrands.length,
            successCount: this.results.length,
            failedCount: this.failedBrands.length,
            results: this.results,
            failed: this.failedBrands
        };
        
        await fs.writeFile(tempFile, JSON.stringify(tempData, null, 2), 'utf8');
        console.log(`  💾 중간 결과 저장: ${tempFile}`);
    }

    // 최종 결과 저장
    async saveResults() {
        const timestamp = Date.now();
        
        try {
            // 성공 결과 저장
            if (this.results.length > 0) {
                const successFile = `musinsa_email_success_${timestamp}.json`;
                await fs.writeFile(successFile, JSON.stringify(this.results, null, 2), 'utf8');
                console.log(`✅ 성공 결과 저장: ${successFile}`);
            }
            
            // 실패 결과 저장
            if (this.failedBrands.length > 0) {
                const failedFile = `musinsa_email_failed_${timestamp}.json`;
                await fs.writeFile(failedFile, JSON.stringify(this.failedBrands, null, 2), 'utf8');
                console.log(`❌ 실패 결과 저장: ${failedFile}`);
            }
            
            // 전체 요약 저장
            const totalProcessed = this.results.length + this.failedBrands.length;
            const summary = {
                processedAt: new Date().toISOString(),
                totalProcessed,
                successCount: this.results.length,
                failedCount: this.failedBrands.length,
                successRate: totalProcessed > 0 ? `${((this.results.length / totalProcessed) * 100).toFixed(1)}%` : '0%',
                results: this.results,
                failed: this.failedBrands,
                emails: this.results.map(r => ({
                    brandName: r.brandName,
                    email: r.musinsaEmail,
                    company: r.musinsaSellerInfo?.company
                }))
            };
            
            const summaryFile = `musinsa_email_summary_${timestamp}.json`;
            await fs.writeFile(summaryFile, JSON.stringify(summary, null, 2), 'utf8');
            console.log(`📊 전체 요약 저장: ${summaryFile}`);
            
        } catch (error) {
            console.error('결과 저장 실패:', error);
        }
    }

    async close() {
        if (this.browser) {
            await this.browser.close();
            console.log('🔒 브라우저 종료');
        }
    }
}

// 메인 실행 함수
async function processFailedBrands(jsonFilePath) {
    const collector = new MusinsaEmailCollector();
    
    try {
        await collector.init();
        
        // 기존 JSON 파일 로드
        console.log(`📂 JSON 파일 로드: ${jsonFilePath}`);
        const fileContent = await fs.readFile(jsonFilePath, 'utf8');
        const originalData = JSON.parse(fileContent);
        
        // 실패 및 스킵된 브랜드 결합
        const brandsToProcess = [
            ...(originalData.failedResults || []),
            ...(originalData.skippedResults || [])
        ];
        
        console.log(`📋 처리 대상:`);
        console.log(`  - 실패 브랜드: ${originalData.failedResults?.length || 0}개`);
        console.log(`  - 스킵 브랜드: ${originalData.skippedResults?.length || 0}개`);
        console.log(`  - 총 처리: ${brandsToProcess.length}개`);
        
        if (brandsToProcess.length === 0) {
            console.log('❌ 처리할 브랜드가 없습니다.');
            return;
        }
        
        // 처리할 브랜드 수를 제한 (테스트용)
        const testBrands = brandsToProcess.slice(0, 50); // 처음 50개만 테스트
        console.log(`🧪 테스트용으로 ${testBrands.length}개 브랜드만 처리합니다.`);
        
        // 브랜드 처리
        await collector.processBrands(testBrands, {
            delay: 3000,      // 3초 지연 (더 짧게)
            batchSize: 5,     // 5개씩 배치 처리 (더 작게)
            maxRetries: 2     // 최대 2회 재시도
        });
        
        // 결과 저장
        await collector.saveResults();
        
    } catch (error) {
        console.error('❌ 전체 프로세스 오류:', error);
    } finally {
        await collector.close();
    }
}

// 특정 브랜드만 처리하는 함수
async function processSingleBrand(brandName, brandNameEnglish = null) {
    const collector = new MusinsaEmailCollector();
    
    try {
        await collector.init();
        
        const brand = {
            brandName,
            brandNameEnglish,
            uniqueId: `${brandName}_${brandNameEnglish || ''}`,
            category: 'manual'
        };
        
        await collector.processBrand(brand, 0, 1);
        await collector.saveResults();
        
    } catch (error) {
        console.error('❌ 단일 브랜드 처리 오류:', error);
    } finally {
        await collector.close();
    }
}

// 사용 예시
if (require.main === module) {
    const args = process.argv.slice(2);
    
    if (args.length === 0) {
        console.log(`
사용법:
  node musinsa_collector.js <JSON파일경로>              # 실패/스킵 브랜드 일괄처리
  node musinsa_collector.js single <한글브랜드명> [영어브랜드명]  # 단일 브랜드 처리

예시:
  node musinsa_collector.js brand_email_collection_final_1750013198088.json
  node musinsa_collector.js single "이스트팩" "EASTPAK"
        `);
        process.exit(1);
    }
    
    if (args[0] === 'single') {
        if (args.length < 2) {
            console.error('❌ 브랜드명을 입력해주세요.');
            process.exit(1);
        }
        processSingleBrand(args[1], args[2]).catch(console.error);
    } else {
        processFailedBrands(args[0]).catch(console.error);
    }
}

module.exports = { MusinsaEmailCollector, processFailedBrands, processSingleBrand };