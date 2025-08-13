% 复杂的主脚本 - 包含多层调用关系
function complex_main()
    % 第一层调用
    result1 = basic_calculation(10, 20);
    result2 = data_processor([1, 2, 3, 4, 5]);
    
    % 第二层调用
    display_manager(result1);
    plot_manager(result2);
    
    % 第三层调用
    utils = utility_manager();
    utils.log_info('Complex main completed');
end

function result = basic_calculation(a, b)
    result = a + b;
    % 调用工具函数
    validate_input(a);
    validate_input(b);
end

function data = data_processor(input_data)
    data = input_data * 2;
    % 调用验证函数
    validate_data(data);
end

function validate_input(value)
    if ~isnumeric(value)
        error('Invalid input type');
    end
end

function validate_data(data)
    if isempty(data)
        error('Empty data');
    end
end 